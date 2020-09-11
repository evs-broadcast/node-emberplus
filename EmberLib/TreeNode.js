"use strict";
const BER = require('../ber.js');
const ElementInterface = require("./ElementInterface");
const Invocation = require("./Invocation");
const Command = require("./Command");
const {COMMAND_GETDIRECTORY, COMMAND_SUBSCRIBE, COMMAND_UNSUBSCRIBE} = require("./constants");
const Errors = require("../Errors");

class TreeNode extends ElementInterface {
    constructor() {
        super();
        /** @type {TreeNode} */
        this._parent = null;
        this._subscribers = new Set();
    }
    
    _isSubscribable(callback) {
        return (callback != null && 
            (this.isParameter() || this.isMatrix()));
    }

    _subscribe(callback) {
        this._subscribers.add(callback);
    }

    _unsubscribe(callback) {
        this._subscribers.delete(callback);
    }

    /**
     * 
     * @param {TreeNode} child 
     */
    addChild(child) {
        TreeNode.addElement(this, child);
    }
    
    /**
     * 
     * @param {TreeNode} element 
     */
    addElement(element) {
        TreeNode.addElement(this, element);
    }
    /**
     * 
     */
    addResult(result) {
        this.result = result;
    }

    /**
     * 
     */
    clear() {
        this.elements = undefined;
    }

    get children() {
        let it = {};
        const self = this;
        it[Symbol.iterator] = function*() {
            if (self.elements == null) { return null;}
            for(let child of self.elements.entries()) {
                yield child[1];
            }
        }
        return it;
    }

    /**
     * 
     * @param {BER} ber 
     */
    decodeChildren(ber) {
        const seq = ber.getSequence(BER.APPLICATION(4));
        while(seq.remain > 0) {
            const nodeSeq = seq.getSequence(BER.CONTEXT(0));
            this.addChild(TreeNode.decode(nodeSeq));
        }
    }

    /**
     * 
     * @param {BER} ber 
     */
    encode(ber) {
        ber.startSequence(BER.APPLICATION(0));
        if(this.elements != null) {
            const elements = this.getChildren();
            ber.startSequence(BER.APPLICATION(11));
            for(var i=0; i < elements.length; i++) {
                ber.startSequence(BER.CONTEXT(0));
                elements[i].encode(ber);
                ber.endSequence(); // BER.CONTEXT(0)
            }
            ber.endSequence();
        }
        if (this.result != null) {
            this.result.encode(ber);
        }
        ber.endSequence(); // BER.APPLICATION(0)
    }

    /**
     * 
     * @param {BER} ber 
     */
    encodeChildren(ber) {
        const children = this.getChildren();
        if(children != null) {
            ber.startSequence(BER.CONTEXT(2));
            ber.startSequence(BER.APPLICATION(4));
            for(var i = 0; i < children.length; i++) {
                ber.startSequence(BER.CONTEXT(0));
                children[i].encode(ber);
                ber.endSequence();
            }
            ber.endSequence();
            ber.endSequence();
        }
    }

    /**
     * 
     * @param {BER} ber 
     */
    encodePath(ber) {
        if (this.isQualified()) {
            ber.startSequence(BER.CONTEXT(0));
            ber.writeRelativeOID(this.path, BER.EMBER_RELATIVE_OID);
            ber.endSequence(); // BER.CONTEXT(0)
        }
    }

    /**
     * @returns {TreeNode}
     */
    getNewTree() {
        return new TreeNode();
    }

    /**
     * @returns {boolean}
     */
    hasChildren() {
        return this.elements != null && this.elements.size > 0;
    }

    /**
     * @returns {boolean}
     */
    isRoot() {
        return this._parent == null;
    }

    /**
     * @returns {boolean}
     */
    isStream() {
        return this.contents != null &&
            this.contents.streamIdentifier != null;
    }

    /**
     * @returns {TreeNode}
     */
    getMinimalContent() {
        let obj;
        if (this.isQualified()) {
            obj = new this.constructor(this.path);
        }
        else {
            obj = new this.constructor(this.number);
        }
        if (this.contents != null) {
            obj.contents= this.contents;
        }
        return obj;
    }
    /**
     * @returns {TreeNode}
     */
    getDuplicate() {
        const obj = this.getMinimal();
        obj.update(this);
        return obj;
    }
    
    getMinimal() {
        if (this.isQualified()) {
            return new this.constructor(this.path);
        }
        else {
            return new this.constructor(this.number);
        }
    }
    
    getTreeBranch(child, modifier) {
        const m = this.getMinimal();
        if(child != null) {
            m.addChild(child);
        }
    
        if(modifier != null) {
            modifier(m);
        }
    
        if(this._parent === null) {
            return m;
        }
        else {
            return this._parent.getTreeBranch(m);
        }
    }
    
    getRoot() {
        if(this._parent == null) {
            return this;
        } else {
            return this._parent.getRoot();
        }
    }
    
    /**
     * 
     * @param {Command} cmd 
     */
    getCommand(cmd) {
        return this.getTreeBranch(cmd);
    }

    /**
     * 
     * @param {function} callback 
     */
    getDirectory(callback) {
        if (this._isSubscribable(callback) && !this.isStream()) {
            this._subscribe(callback);
        }
        return this.getCommand(new Command(COMMAND_GETDIRECTORY));
    }
    
    
    /**
     * @returns {TreeNode[]}
     */
    getChildren() {
        if(this.elements != null) {
            return [...this.elements.values()];
        }
        return null;
    }
    
    /**
     * @returns {number}
     */
    getNumber() {
        if (this.isQualified()) {
            return TreeNode.path2number(this.getPath());
        }
        else {
            return this.number;
        }
    }
    
    /**
     * @returns {TreeNode}
     */
    getParent() {
        return this._parent;
    }

    /**
     * 
     * @param {string} path 
     * @returns {TreeNode}
     */
    getElementByPath(path) {
        if (this.elements == null || this.elements.size === 0) {
            return null;
        }
        if (this.isRoot()) {
            // check if we have QualifiedElement
            const node = this.elements.get(path);
            if (node != null) {
                return node;
            }
        }
        const myPath = this.getPath();
        if (path == myPath) {
            return this;
        }
        const myPathArray = this.isRoot() ? [] : myPath.split(".");
        let pathArray = path.split(".");        
    
        if (pathArray.length < myPathArray.length) {
            // We are lower in the tree than the requested path
            return null;
        }

        // Verify that our path matches the beginning of the requested path
        for(var i = 0; i < myPathArray.length; i++) {
            if (pathArray[i] != myPathArray[i]) {
                return null;
            }
        }
        //Now add child by child to get the requested path
        let node = this;
        while(myPathArray.length != pathArray.length) {
            const number = pathArray[myPathArray.length];
            node = node.getElementByNumber(number);
            if (node == null) {
                return null;
            }
            if (node.isQualified() && node.path == path) {
                return node;
            }
            myPathArray.push(number);                
        }
        return node;
    }
    
    /**
     * 
     * @param {number} number 
     * @returns {TreeNode}
     */
    getElementByNumber(number) {
        const n = Number(number);
        if (this.elements != null) {
            return this.elements.get(n);
        }
        return null;
    }
    /**
     * 
     * @param {string} identifier 
     * @returns {TreeNode}
     */
    getElementByIdentifier(identifier) {
        const children = this.getChildren();
        if (children == null) return null;
        for(let i = 0; i < children.length; i++) {
            if(children[i].contents != null &&
              children[i].contents.identifier == identifier) {
                return children[i];
            }
        }
        return null;
    }
    
    /**
     * 
     * @param {number|string} id 
     * @returns {TreeNode}
     */
    getElement(id) {
        if(Number.isInteger(id)) {
            return this.getElementByNumber(id);
        } else {
            return this.getElementByIdentifier(id);
        }
    }


    /**
     * @returns {string}
     */
    getPath() {
        if (this.path != null) {
            return this.path;
        }
        if(this._parent == null) {
            if(this.number == null) {
                return "";
            } 
            else {
                return this.number.toString();
            }
        } else {
            let path = this._parent.getPath();
            if(path.length > 0) {
                path = path + ".";
            }
            return path + this.number;
        }
    }

        /**
     * 
     * @param {FunctionArgument[]} params 
     * @returns {TreeNode}
     */
    invoke(params) {      
        if (!this.isFunction()) {
            throw new Errors.InvalidEmberNode(this.getPath(), "Invoke only for Ember Function");
        }  
        const invocation = new Invocation(Invocation.newInvocationID());
        invocation.arguments = params;
        const req = this.getCommand(Command.getInvocationCommand(invocation));
        return req;
    }

    /**
     * 
     */
    toJSON() {
        const res = {nodeType: this.constructor.name};
        const node = this;
        if (this.isRoot()) {
            const elements = this.getChildren();
            return { elements: elements ? elements.map(e => e.toJSON()) : [] };
        }
        res.number = node.getNumber();
        res.path = node.getPath();        
        if (node.contents) {
            for(let prop in node.contents) {
                if (prop[0] == "_" || node.contents[prop] == null) {
                    continue;
                }
                if (node.contents.hasOwnProperty(prop)) {
                    const type = typeof node.contents[prop];
                    if ((type === "string") || (type === "number")) {
                        res[prop] = node.contents[prop];
                    }
                    else if (node.contents[prop].value != null) {
                        res[prop] = node.contents[prop].value;
                    }
                    else {
                        res[prop] = node.contents[prop];
                    }
                }
            }
        }
        if (node.isMatrix()) {
            if (node.targets) {
                res.targets = node.targets.slice(0);
            }
            if (node.sources) {
                res.sources = node.sources.slice(0);
            }
            if (node.connections) {
                res.connections = {};
                for (let target in node.connections) {
                    if (node.connections.hasOwnProperty(target)) {
                        res.connections[target] = {target: target, sources: []};
                        if (node.connections[target].sources) {
                            res.connections[target].sources = node.connections[target].sources.slice(0);
                        }
                    }
                }
    
            }
        }
        const children = node.getChildren();
        if (children) {
            res.children = [];
            for(let child of children) {
                res.children.push(child.toJSON());
            }
        }
        return res;
    }

        /**
     * 
     * @param {function} callback 
     */
    subscribe(callback) {
        if (this._isSubscribable(callback) && this.isStream()) {
            this._subscribe(callback);
        }
        return this.getCommand(new Command(COMMAND_SUBSCRIBE));
    }

    /**
     * 
     * @param {*} callback 
     */
    unsubscribe(callback) {
        this._unsubscribe(callback);
        return this.getCommand(new Command(COMMAND_UNSUBSCRIBE));
    }

    /**
     * 
     * @param {TreeNode} other 
     */
    update(other) {
        let modified = false;
        if ((other != null) && (other.contents != null)) {
            if (this.contents == null) {
                this.contents = other.contents;
                modified = true;
            }
            else {
                for (var key in other.contents) {
                    if (key[0] === "_") { continue; }
                    if (other.contents.hasOwnProperty(key) && 
                        this.contents[key] != other.contents[key]) {
                        this.contents[key] = other.contents[key];
                        modified = true;
                    }
                }
            }
        }
        return modified;
    }

    updateSubscribers() {
        if (this._subscribers != null) {
            for(let cb of this._subscribers) {
                cb(this);
            }
        }
    }

    /**
     * 
     * @param {TreeNode} parent 
     * @param {TreeNode} element 
     */
    static addElement(parent, element) {
        /* 
        Store element hashed by number direct to the parent.
        But if QualifiedElement, it could be directly attached to the root.
        In this case, use the path instead of number.
        However, if the path is a single number, it is equivalent to number.
         */
        element._parent = parent;
        if(parent.elements == null) {
            parent.elements = new Map();
        }
        if (parent.isRoot() && element.isQualified()) {
            const path = element.getPath().split(".");
            if (path.length > 1) {
                parent.elements.set(element.getPath(), element);
                return;
            }
        }
        parent.elements.set(element.getNumber(), element);
    }

    static path2number(path) {
        try {
            const numbers = path.split(".");
            if (numbers.length > 0) {
                return Number(numbers[numbers.length - 1]);
            }
        }
        catch(e) {
            // ignore
        }
    }
}

module.exports = TreeNode;

