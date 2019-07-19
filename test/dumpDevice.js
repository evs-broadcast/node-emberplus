"use strict";
const fs = require("fs");
const TreeServer = require("../server");
const DeviceTree = require("../").DeviceTree;

if (process.argv.length != 5) {
    console.error("usage: dumpDevice host port output_file");
    return -1;
}

const [ip, port, filePath] = process.argv.slice(2);

const client = new DeviceTree(ip, port);
client._debug = true;

client.on("error", error => {
    console.error(error.message);
    exit(-1);
});

const initialTime = Date.now();

return Promise.resolve()
    .then(() => client.connect())
    .then(() => {
        console.log("client connected");
        return client.getDirectory();
    })
    .then(() => {
        if (
            client.root !== undefined &&
            client.root.elements !== undefined &&
            client.root.elements.length > 0
        ) {
            console.debug(`Expanding tree for ${ip}:${port}`);
            return client.expand(client.root.elements[0]);
        } else {
            console.error(`Invalid tree received from ${ip}:${port}`);
            return Promise.resolve();
        }
    })
    .then(() => {
        if (
            client.root !== undefined &&
            client.root.elements !== undefined &&
            client.root.elements.length > 0
        ) {
            client.disconnect();
            const durationMs = Date.now() - initialTime;

            console.log(`Full tree received for ${ip}:${port} in ${durationMs/1000}s`);

            client.saveTree(data => {
                fs.writeFileSync(filePath, data);
                console.log(`Content saved to ${filePath}`);
            });
        }
    })
    .catch(error => {
        console.error(error.message, error.stack);
        exit(-1);
    });
