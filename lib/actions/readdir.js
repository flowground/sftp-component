/*eslint no-invalid-this: 0 no-console: 0*/
'use strict';
const Client = require('ssh2-sftp-client');
const path = require('path');
const PassThrough = require('stream').PassThrough; 
const eioUtils = require('elasticio-node').messages;
const url = require('url');
const attachments = require('../attachments.js');
const Minimatch = require('minimatch').Minimatch;

const sftp = new Client();

/**
 * This function will be called during component intialization
 *
 * @param cfg
 * @returns {Promise}
 * @param {string} cfg.host - host of sftp connection
 * @param {string} cfg.username - username of sftp connection
 * @param {string} cfg.password - password of sftp connection
 */
function init(cfg) {
    const parsedURL = url.parse(cfg.host);
    return sftp.connect(
        {
            host: parsedURL.hostname || parsedURL.path,
            port: parsedURL.port || 22,
            username: cfg.username,
            password: cfg.password
        }
    );
}

/**
 * This method will be called from elastic.io platform providing following data
 *
 * @param {object} msg incoming message - ignored
 * @param {object} cfg configuration
 * @param {string} cfg.directory - directory to read files from
 * @param {string} cfg.glob - pattern to match file extension
 * @param {boolean} cfg.deleteAfterRead - delete files after reading
 */
async function processAction(msg, cfg) {
        console.log('CFG: %j', cfg);
        
        const dir = cfg.directory || '/';
        console.log('Getting files from SFTP directory=%j', dir);
        
        let files = await sftp.list(cfg.directory);

        var glob = new Minimatch(cfg.glob || '*');
        var fileregexp = new RegExp(cfg.regexp || '');
        var uuidregexp = new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$');

        let len = Number(cfg.fileNr);
        if(!len || len > files.length){
            len = files.length;
        }

        for(var i=0; i<len; i++) {
            let file = files[i];          
            if(!glob.match(file.name) || !fileregexp.test(file.name) || file.type !== '-') {
                continue;
            }

            var stream = new PassThrough();
            var pathFile = path.join(cfg.directory, file.name);
            
            console.log('Getting file: %j', file);
            //highWaterMark set for fixing https://github.com/mscdex/ssh2/issues/739#issuecomment-437226290
            sftp.get(pathFile, stream, {highWaterMark: 63*1024});

            var name = (uuidregexp.test(file.name.substring(0, 36))) ? file.name.substring(37, file.name.length) : file.name 

            var msg = eioUtils.newMessageWithBody({
                name: name,
                size: file.size
            });

            await attachments.addAttachment(msg, name, stream, file.size);
            if(cfg.deleteAfterRead) {
                console.log('Deleting file', file.name);
                await sftp.delete(pathFile);
            }

            this.emit('data', msg);
        }
}

module.exports.process = processAction;
module.exports.init = init;