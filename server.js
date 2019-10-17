const fs = require("fs");
const path = require("path");
const Koa = require("koa");
const KoaRouter = require("@koa/router");
const koaCors = require("@koa/cors");
const koaMulter = require("@koa/multer");
const mimeTypes = require("mime-types");
const saltedMd5 = require("salted-md5");

const PORT = 3000;

const app = new Koa();
const mainRouter = new KoaRouter();

const ROOT_PATH = "./project/";
const ALLOW_EDIT_PHP = false;
const USE_MD5 = false;
const MD5_SALT = "";

const CONFIG_PATH = "wide_config.json";

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) process.exit(-1);
    let content = fs.readFileSync(CONFIG_PATH);
    let config = JSON.parse(content);
    if (!config.projects) console.log("Config doesn't have any projects");
    return config;
}

let config = loadConfig();

mainRouter.post("/", async ctx => {
    let {body} = ctx.request;
    console.log(body);
    
    if (!body.action) {
        ctx.body = `{"status":-1, "msg":"action missing"}`;
        return;
    }

    if (!body.key) return ctx.body = {status: -1, msg: "key missing"};
    let key = body.key;
    if (USE_MD5) key = saltedMd5(key, MD5_SALT);
    if (!config.projects[key]) return ctx.body = {status: -1, msg: "wrong key"};
    let project = config.projects[key];
    if (!project.folder) return ctx.body = {status: -1, msg: "folder missing from project config"};

    if (body.action === "load") {
        if (!ALLOW_EDIT_PHP && body.filename.indexOf(".php") > -1) {
            ctx.res.status = 403;
            return;
        }

        let fileName = path.join(ROOT_PATH, body.filename);
        if (!fs.existsSync(fileName)) {
            ctx.res.status = 404;
            return;
        }

        ctx.body = await fs.promises.readFile(fileName);
    } else if (body.action === "save") {
        if (!body.filename || !body.content) {
            ctx.body = {"status":-1,"msg":"params missing"};
            return;
        }

        if (!ALLOW_EDIT_PHP && body.filename.indexOf(".php") > -1) {
            ctx.body = {"status":-1, "msg":"cannot save serverside files"};
            return;
        }

        if (body.filename.indexOf("..") > -1) {
            ctx.body = {"status":-1,"msg":"invalid filename"};
            return;
        }

        let fileName = path.join(ROOT_PATH, body.filename);
        await fs.promises.writeFile(fileName, body.content);
        ctx.body = {status: 1, msg: "file saved", filename: fileName};
    } else if (body.action === "list") {
        if (!body.folder) return ctx.body = {status: -1, msg: "params missing"};
        if (body.folder.indexOf("..") > -1) return ctx.body = `{"status":-1,"msg":"invalid folder"}`;

        let folder = path.join(ROOT_PATH, body.folder);
        let responsefolder = body.folder+'/';
        if (!fs.existsSync(folder)) return ctx.body = {status: -1, msg: "folder doesn't exist"};

        let stat = await fs.promises.stat(folder);
        if (!stat.isDirectory()) return ctx.body = {status: -1, msg: "folder doesn't exist"};

        let files = await fs.promises.readdir(folder);

        let finalFiles = [];
        for (let file of files) {
            let filePath = path.join(folder, file);
            let stat = await fs.promises.stat(filePath);
            console.log(path.basename(file))
            finalFiles.push({
                name: path.basename(file),
                is_dir: stat.isDirectory(),
                mime_type: mimeTypes.contentType(file),
                size: stat.size,
            });
        }

        ctx.body = {
            status: 1,
            msg: "file list",
            project: project ? project.name : null,
            folder: responsefolder,
            files: finalFiles,
        };
    } else if (body.action === "project") {
        ctx.body = {
            status: 1,
            msg: "project info",
            data: project,
        };
    } else if (body.action === "mkdir") {
        if (!body.folder) return ctx.body = {status: -1, msg: "params missing"};
        if (body.folder.indexOf("..") > -1) return ctx.body = {status: -1, msg: "invalid folder name"};
        
        let folder = path.join(ROOT_PATH, body.folder);
        try {
            await fs.promises.mkdir(folder);
        } catch {
            ctx.body = {status: -1, msg: "cannot create folder, not allowed",debug: `'${folder}'`};
        }
        
        ctx.body = {status: 1, msg: "folder created"};
    } else if (body.action === "move") {
        if (!body.filename || !body.new_filename) return ctx.body = {status: -1, msg: "params missing"};
        if (body.filename.indexOf("..") > -1 || body.new_filename.indexOf("..") > -1)
            return ctx.body = {status: -1, msg: "invalid filename"};
        if (!ALLOW_EDIT_PHP && (body.filename.indexOf(".php") > -1 || body.new_filename.indexOf(".php") > -1))
            return ctx.body = {status: -1, msg: "cannot move this extensions"};

        let filePath = path.join(ROOT_PATH, body.filename);
        let newFilepath = path.join(ROOT_PATH, body.new_filename);

        try {
            await fs.promises.rename(filePath, newFilepath);
        } catch {
            ctx.body = {status: -1, msg: "cannot move file, not allowed", debug: `'${filePath}'`};
        }

        ctx.body = {
            status: 1,
            msg: "file moved",
            filename: newFilepath,
        };
    } else if (body.action === "delete") {
        if (!body.filename) return ctx.body = {status: -1, msg: "params missing"};
        if (body.filename.indexOf("..") > -1) return ctx.body = {status: -1, msg: "invalid filename"};
        
        if (!ALLOW_EDIT_PHP && body.filename.indexOf(".php") > -1) {
            ctx.body = {"status":-1, "msg":"cannot delete serverside files"};
            return;
        }

        let filePath = path.join(ROOT_PATH, body.filename);
        try {
            await fs.promises.unlink(filePath);
            ctx.body = {
                status: 1,
                msg: "file deleted",
            };
        } catch {
            ctx.body = {
                status: -1,
                msg: "cannot delete file, not allowed",
                debug: `'${filePath}'`,
            };
        }
    } else if (body.action === "autocomplete") {
        if (!body.filename) return ctx.body = {status: -1, msg: "params missing"};
        if (body.filename.indexOf("..") > -1) return ctx.body = {status: -1, msg: "invalid filename"};

        let tokens = body.filename.split("/");
        let folder = tokens.slice(0, tokens.length - 1).join("/");
        let start = tokens[tokens.length - 1];
        let files = await fs.promises.readdir(path.join(ROOT_PATH, folder));

        let validFiles = [];
        for (let file of files) {
            if (file.includes(start)) validFiles.push(file);
        }

        ctx.body = {
            status: 1,
            msg: "file autocompleted",
            data: validFiles,
        };
    }
});

app.use(koaCors());
app.use(koaMulter().none());
app.use(mainRouter.routes());
app.use(mainRouter.allowedMethods());
app.listen(PORT, () => console.log(`Server started listening on port ${PORT}`));

module.exports = app;


var express = require('express')
var pty = require('node-pty');

const app2 = express();
const expressWs = require('express-ws')(app2);


app2.use(function (req, res, next) {
    console.log('middleware');
    req.testing = 'testing';
    return next();
});

// Instantiate shell and set up data handlers
app2.ws('/shell', (ws, req) => {
    // Spawn the shell
    const shell = pty.spawn('/bin/bash', [], {
        name: 'xterm-color',
        cwd: ROOT_PATH,
        env: process.env
    });
    // For all shell data send it to the websocket
    shell.on('data', (data) => {
        ws.send(data);
    });
    // For all websocket data send it to the shell
    ws.on('message', (msg) => {
        shell.write(msg);
    });
});

// Start the application
app2.listen(8886);
