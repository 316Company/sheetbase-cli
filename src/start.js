const CLI           = require('clui');
const Spinner       = CLI.Spinner;
const chalk         = require('chalk');
const git           = require('simple-git/promise');
const replace       = require('replace-in-file');
const randomstring  = require('randomstring');
const execSync      = require('child_process').execSync;
const editJsonFile  = require('edit-json-file');
const opn           = require('opn');

const file = require('./lib/file');
const inquirer = require('./lib/inquirer');
const google = require('./lib/google');
const config = require('./lib/config');

function isValidGitUrl(str) {
    return str && str.substr(0, 8) === 'https://' && str.substr(str.length - 4, 4) === '.git';
}

async function setupDrive(projectName, databaseId) {
    projectName = projectName.charAt(0).toUpperCase() + projectName.slice(1);
    
    const client = await google.getClient();
    if(!client) return {};

    let projectFolder = null;
    let contentFolder = null;
    let backendScript = null;
    let database = null;
    let databaseBackend = null;

    try {
        let projectFolderResponse = await client.request({
            method: 'post',
            url: 'https://www.googleapis.com/drive/v3/files',
            data: {
                'name': 'Sheetbase Project: '+ projectName,
                'mimeType': 'application/vnd.google-apps.folder'
            }
        });
        if(projectFolderResponse.data.id) {
            // projectFolder
            projectFolder = projectFolderResponse.data.id;
            
            // content Folder
            let contentFolderResponse = await client.request({
                method: 'post',
                url: 'https://www.googleapis.com/drive/v3/files',
                data: {
                    'name': 'content',
                    'mimeType': 'application/vnd.google-apps.folder',
                    'parents': [projectFolder]
                }
            });
            if(contentFolderResponse.data.id) contentFolder = contentFolderResponse.data.id;
    
            // database
            if(databaseId) {
                let databaseResponse = await client.request({
                    method: 'post',
                    url: 'https://www.googleapis.com/drive/v3/files/'+ databaseId +'/copy',
                    data: {
                        'name': projectName +' Database',
                        'parents': [projectFolder]
                    }
                });
                if(databaseResponse.data.id) database = databaseResponse.data.id;
            }
            
            // backendScript
            let backendScriptResponse = await client.request({
                method: 'post',
                url: 'https://script.googleapis.com/v1/projects',
                data: {
                    'title': projectName +' Backend',
                    'parentId': projectFolder
                }
            });
            if(backendScriptResponse.data.scriptId) backendScript = backendScriptResponse.data.scriptId;
            
        }
    } catch(error) {
        console.log(
            chalk.yellow('(!) Error setting up one or more Drive files, please set them up manually!')
        );
    }


    return {
        projectFolder,
        contentFolder,
        backendScript,
        database,
        databaseBackend
    };
}

function buildFolderName(folderName) {
    return folderName.replace(/\ /g, '-')
        .replace(/\</g, '-')
        .replace(/\,/g, '-')
        .replace(/\>/g, '-')
        .replace(/\./g, '-')
        .replace(/\?/g, '-')
        .replace(/\//g, '-')
        .replace(/\:/g, '-')
        .replace(/\;/g, '-')
        .replace(/\"/g, '-')
        .replace(/\'/g, '-')
        .replace(/\{/g, '-')
        .replace(/\[/g, '-')
        .replace(/\}/g, '-')
        .replace(/\]/g, '-')
        .replace(/\|/g, '-')
        .replace(/\\/g, '-')
        .replace(/\`/g, '-')
        .replace(/\~/g, '-')
        .replace(/\!/g, '-')
        .replace(/\@/g, '-')
        .replace(/\#/g, '-')
        .replace(/\$/g, '-')
        .replace(/\%/g, '-')
        .replace(/\^/g, '-')
        .replace(/\&/g, '-')
        .replace(/\*/g, '-')
        .replace(/\(/g, '-')
        .replace(/\)/g, '-')
        .replace(/\+/g, '-')
        .replace(/\=/g, '-')
}

module.exports = {

    run: async (repo, dir, remote) => {
        var _this = this;

        if (repo.substr(0, 18) !== 'https://github.com' && repo.substr(repo.length - 4, 4) !== '.git')
            repo = 'https://github.com/316Company/sheetbase-' + repo + '.git';

        // build valid folder name & check for existance
        dir = buildFolderName(dir);
        if (file.directoryExists('./' + dir)) {
            return console.log(
                chalk.red('\nDirectory exists, try other name or delete it!')
            );
        }

        // check login status
        const client = await google.getClient();
        if(!client)
            console.log(
                chalk.yellow('\n(!) Please login to setup and config the project automatically!') +
                '\n$ '+ chalk.green('sheetbase login')
            );



        /**
         * step 0: start action
         */
        console.log('\n> Create new Sheebase project.');




        /**
         * step 1: clone repo
         */
        let status = new Spinner('Creating new project ...'); status.start();
        try {
            await git().clone(repo, dir);

            if (!file.fileExists('./' + dir + '/sheetbase.config.json')) {
                console.log(
                    chalk.yellow('\n(!) Looks like the repo is not a valid Sheetbase theme! Repo: ' + repo)
                );
            }
        } catch (error) {
            status.stop();
            return console.log(
                chalk.red('\nRepo not exists or errors happen! Repo: ' + repo)
            );
        }



        /**
         * step 2: setup drive and other values
         */
        let configs = await config.getConfigs(dir);
        const driveIds = await setupDrive(dir, configs.database);
        const apiKey = randomstring.generate();
        const encryptionKey = randomstring.generate({
            length: 12,
            charset: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_!@#$%&*'
        });


        /**
         * step 3: update config
         */
        try {
            let filePath = '';
            let jsonFile = null;

            // package.json
            filePath = './' + dir + '/package.json';
            jsonFile = editJsonFile(filePath);
            jsonFile.set('name', dir);
            jsonFile.save();

            // sheetbase.config.json
            filePath = './' + dir + '/sheetbase.config.json';
            if (file.fileExists(filePath)) {
                jsonFile = editJsonFile(filePath);
                jsonFile.set('name', dir);
                jsonFile.set('driveFolder', driveIds.projectFolder||'');
                jsonFile.save();
            }

            // backend/.clasp.json
            filePath = './' + dir + '/backend/.clasp.json';
            jsonFile = editJsonFile(filePath);
            jsonFile.set('scriptId', driveIds.backendScript||'<scriptId>');
            jsonFile.save();


            // backend/configs/Sheetbase.config.js
            filePath = './' + dir + '/backend/configs/Sheetbase.config.js';
            if (file.fileExists(filePath)) {
                await replace({
                    files: filePath,
                    from: [
                        /\"apiKey\"\: \".*\"/,
                        /\"encryptionKey\"\: \".*\"/,

                        /\"database\"\: \".*\"/,

                        /\"contentFolder\"\: \".*\"/
                    ],
                    to: [
                        '\"apiKey\": \"' + apiKey + '\"',
                        '\"encryptionKey\": \"' + encryptionKey + '\"',

                        '\"database\"\: \"'+ (driveIds.database||'<your_spreadsheet_id>') +'\"',

                        '\"contentFolder\"\: \"'+ (driveIds.contentFolder||'<your_folder_id>') +'\"'
                    ]
                });
            }

            // src/configs/sheetbase.config.ts
            filePath = './' + dir + '/src/configs/sheetbase.config.ts';
            if (file.fileExists(filePath)) {
                await replace({
                    files: filePath,
                    from: [
                        /\"apiKey\"\: \".*\"/,

                        /\"database\"\: \".*\"/,
                        /\"backend\"\: \".*\"/
                    ],
                    to: [
                        '\"apiKey\"\: \"' + apiKey + '\"',

                        '\"database\"\: \"'+ (driveIds.database||'<your_spreadsheet_id>') +'\"',
                        '\"backend\"\: \"<your_webapp_id>\"'
                    ]
                });
            }

        } catch (error) {
            status.stop();
            return console.log(
                chalk.red('\nError setting up project configuration!')
            );
        }




        /**
         * step 4: setup git 
         */
        await file.rmDir('./' + dir + '/.git');
        await git('./' + dir).init();
        await git('./' + dir).add('./*');
        await git('./' + dir).commit('Initial commit');
        if(remote) {
            // setup remote
            status.stop();
            try {                
                if (typeof remote !== 'string') {
                    const remoteAnswers = await inquirer.askForRemoteRepo();
                    remote = remoteAnswers.remote;
                }
                if(isValidGitUrl(remote)) {
                    await git('./' + dir).addRemote('origin', remote);
                }
            } catch (error) {
                return console.log(
                    chalk.red('\nError setting up git! You may check your .git URL or connection.')
                );
            }
        } else {
            status.stop();
        }

        console.log('\n'+ chalk.green('New Sheetbase project created successfully!'));



        /**
         * step 5: push & deploy script 
         */
        if(driveIds.backendScript) {
            // push using clasp
            console.log('\n> Push backend script, must have @google/clasp installed.');
            try {
                await execSync('clasp push', {cwd: './'+ dir +'/backend', stdio: 'inherit'});
            } catch(error) {
                return console.log(
                    chalk.red('\nError trying to push backend script.')
                );
            }

            // open script in browser
            opn('https://script.google.com/d/'+ driveIds.backendScript +'/edit', {wait: false});

            // ask for baclend Id
            const backendAnswers = await inquirer.askForBackendId();
            filePath = './' + dir + '/src/configs/sheetbase.config.ts';
            if(backendAnswers.backend && file.fileExists(filePath)) {
                // set backend to config
                await replace({
                    files: filePath,
                    from: [
                        /\"backend\"\: \".*\"/
                    ],
                    to: [
                        '\"backend\"\: \"'+ backendAnswers.backend +'\"'
                    ]
                });

                // git add & commit
                await git('./' + dir).add('./*');
                await git('./' + dir).commit('Update backend');
            }
        }

        

        /**
         * step 6: install packages 
         */
        console.log('\n> Install packages.');
        try {
            await execSync('npm install', {cwd: './'+ dir, stdio: 'inherit'});
        } catch(error) {
            return console.log(
                chalk.red('\nError trying install packages.')
            );
        }



        /**
         * final: response
         */
        let suggestCommandsMessage = '';
        suggestCommandsMessage += '   $ ' + chalk.green('cd ./' + dir);  
        suggestCommandsMessage += '\n   $ ' + chalk.green('sheetbase mine -o') +' - See the Drive folder.';  
        if (isValidGitUrl(remote)) {
            suggestCommandsMessage += '\n   $ ' + chalk.green('git push -u origin master');        
        }

        configs = await config.getConfigs(dir);
        let propertiesMessage = ''; 
            propertiesMessage += '+ Repo: '+ chalk.green(isValidGitUrl(remote) ? remote: 'n/a');
            propertiesMessage += '\n+ Backend: '+ chalk.green(configs.backend||'n/a');
            propertiesMessage += '\n+ Drive folder: '+ chalk.green(configs.projectFolder||'n/a');
            propertiesMessage += '\n+ Backend script: '+ chalk.green(configs.backendScript||'n/a');
            propertiesMessage += '\n+ Database: '+ chalk.green(configs.database||'n/a');
        
        console.log('\n\n\n> Done! What next?\n');
        console.log(suggestCommandsMessage);        
        console.log('\n> Properties & configurations:\n');
        console.log(propertiesMessage);
        console.log('\n');
    }

}