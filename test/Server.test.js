const expect = require("expect");
const TreeServer = require("../server");
const DeviceTree = require("../").DeviceTree;


const LOCALHOST = "127.0.0.1";
const PORT = 9008;


const init = function(_src,_tgt) {
    const targets = _tgt === undefined ? [ "tgt1", "tgt2", "tgt3" ] : _tgt;
    const sources = _src === undefined ? [ "src1", "src2", "src3" ] : _src;
    const labels = function(endpoints) {
        let labels = [];
        for (let i = 0; i < endpoints.length; i++) {
            let endpoint = endpoints[i];
            let l = { identifier: `Label-${i}` };
            if (endpoint) {
                l.value = endpoint;
            }
            labels.push(l);
        }
        return labels;
    };

    const buildConnections = function(s, t) {
        let connections = [];
        for (let i = 0; i < t.length; i++) {
            connections.push({target: `${i}`});
        }
        return connections;
    };

    return [
        {
            // path "0"
            identifier: "scoreMaster",
            children: [
                {
                    // path "0.0"
                    identifier: "identity",
                    children: [
                        {identifier: "product", value: "S-CORE Master"},
                        {identifier: "company", value: "EVS"},
                        {identifier: "version", value: "1.2.0"},
                        {identifier: "author", value: "g.dufour@evs.com"}
                    ]
                },
                {
                    // path "0.1"
                    identifier: "router",
                    children: [
                        {
                            // path 0.1.0
                            identifier: "matrix",
                            type: "oneToN",
                            mode: "linear",
                            targetCount: targets.length,
                            sourceCount: sources.length,
                            connections: buildConnections(sources, targets),
                            labels: ["0.1.1000"]
                        },
                        {
                            identifier: "labels",
                            // path "0.1.1000"
                            number: 1000,
                            children: [
                                {
                                    identifier: "targets",
                                    // Must be 1
                                    number: 1,
                                    children: labels(targets)
                                },
                                {
                                    identifier: "sources",
                                    // Must be 2
                                    number: 2,
                                    children: labels(sources)
                                }
                            ]
                        }
                    ]
                }
            ]
        }
    ];

}
describe("server", function() {

    describe("JSONtoTree", function() {
        let jsonTree;
        beforeAll(function() {
            jsonTree = init();
        });
        it("should generate an ember tree from json", function() {
            const root = TreeServer.JSONtoTree(jsonTree);
            expect(root).toBeDefined();
            expect(root.elements).toBeDefined();
            expect(root.elements.length).toBe(1);
            console.log("root", root.elements[0].contents);
            expect(root.elements[0].contents.identifier).toBe("scoreMaster");
            expect(root.elements[0].children.length).toBe(2);
        });
    });

    describe("Server - Client communication", function() {
        let server,client;
        beforeAll(function() {
            jsonTree = init();
            const root = TreeServer.JSONtoTree(jsonTree);
            server = new TreeServer(LOCALHOST, PORT, root);
            //server._debug = true;
            return server.listen().then(() => {
                console.log("server listening");
            });
        });
        afterAll(function() {
            client.disconnect();
            server.close();
        });
        it("should receive and decode the full tree", function () {
            client = new DeviceTree(LOCALHOST, PORT);
            //client._debug = true;
            return Promise.resolve()
                .then(() => client.connect())
                .then(() => {
                    console.log("client connected");
                    return client.getDirectory()
                })
                .then(() => {
                    expect(client.root).toBeDefined();
                    expect(client.root.elements).toBeDefined();
                    expect(client.root.elements.length).toBe(1);
                    expect(client.root.elements[0].contents.identifier).toBe("scoreMaster");
                    return client.getDirectory(client.root.elements[0]);
                })
                .then(() => {
                    expect(client.root.elements[0].children.length).toBe(2);
                    return client.getDirectory(client.root.elements[0].children[0]);
                })
                .then(() => {
                    expect(client.root.elements[0].children[0].children.length).toBe(4);
                    expect(client.root.elements[0].children[0].children[3].contents.identifier).toBe("author");
                });
        });
    });
});
