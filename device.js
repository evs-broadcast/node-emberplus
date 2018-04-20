const EventEmitter = require('events').EventEmitter
const util = require('util')
const S101Client = require('./client.js').S101Socket
const ember = require('./ember.js')
const BER = require('./ber.js')
const errors = require('./errors.js')

const DEBUG = false

function DeviceTree (host, port) {
  DeviceTree.super_.call(this)
  var self = this
  self._debug = false
  self.timeoutValue = 3000
  self.client = new S101Client(host, port)
  self.root = new ember.Root()
  self.pendingRequests = []
  self.activeRequest = null
  self.timeout = null
  self.callback = undefined
  self.requestID = 0

  self.client.on('connecting', () => {
    self.emit('connecting')
  })

  self.client.on('connected', () => {
    self.emit('connected')
    if (self.callback !== undefined) {
      self.callback()
    }
  })

  self.client.on('disconnected', () => {
    self.emit('disconnected')
  })

  self.client.on('error', (e) => {
    if (self.callback !== undefined) {
      self.callback(e)
    }
    self.emit('error', e)
  })

  self.client.on('emberTree', (root) => {
    self.handleRoot(root)
    if (self._debug) { console.log('Received root', root) }
    if (self.callback) {
      self.callback(undefined, root)
    }
  })
}

util.inherits(DeviceTree, EventEmitter)

var DecodeBuffer = function (packet) {
  var ber = new BER.Reader(packet)
  return ember.Root.decode(ber)
}

DeviceTree.prototype.saveTree = function (f) {
  var writer = new BER.Writer()
  this.root.encode(writer)
  f(writer.buffer)
}

DeviceTree.prototype.isConnected = function () {
  return ((this.client !== undefined) && (this.client.isConnected()))
}

DeviceTree.prototype.connect = function (timeout = 2) {
  return new Promise((resolve, reject) => {
    this.callback = (e) => {
      if (e === undefined) {
        return resolve()
      }
      return reject(e)
    }
    if ((this.client !== undefined) && (this.client.isConnected())) {
      this.client.disconnect()
    }
    this.client.connect(timeout)
  })
}

DeviceTree.prototype.expand = function (node) {
  let self = this
  return self.getDirectory(node).then((res) => {
    let children = node.getChildren()
    if ((res === undefined) || (children === undefined) || (children === null)) {
      if (DEBUG) { console.log('No more children for ', node) }
      return
    }
    let p = []
    for (let child of children) {
      if (DEBUG) { console.log('Expanding child', child) }
      p.push(
        self.expand(child).catch((e) => {
          // We had an error on some expansion
          // let's save it on the child itself
          child.error = e
        })
      )
    }
    return Promise.all(p)
  })
}

DeviceTree.prototype.getDirectory = function (qnode) {
  var self = this
  if (qnode === undefined) {
    self.root.clear()
    qnode = self.root
  }
  return new Promise((resolve, reject) => {
    self.addRequest((error) => {
      if (error) {
        reject(error)
        self.finishRequest()
        return
      }

      let cb = (error, node) => {
        self.clearTimeout() // clear the timeout now. The resolve below may take a while.
        if (error) {
          reject(error)
        } else {
          if (DEBUG) { console.log('Received getDirectory response', node) }
          resolve(node) // make sure the info is treated before going to next request.
        }
        self.finishRequest()
      }

      if (self._debug) { console.log('Sending getDirectory', qnode) }
      self.callback = cb
      self.client.sendBERNode(qnode.getDirectory())
    })
  })
}

DeviceTree.prototype.disconnect = function () {
  if (this.client !== undefined) {
    return this.client.disconnect()
  }
}

DeviceTree.prototype.makeRequest = function () {
  var self = this
  if (self.activeRequest === null && self.pendingRequests.length > 0) {
    self.activeRequest = self.pendingRequests.shift()

    const t = function (id) {
      if (DEBUG) { console.log(`Making request ${id}`, Date.now()) }
      self.timeout = setTimeout(() => {
        self.timeoutRequest(id)
      }, self.timeoutValue)
    }

    t(self.requestID++)
    self.activeRequest()
  }
}

DeviceTree.prototype.addRequest = function (cb) {
  var self = this
  self.pendingRequests.push(cb)
  self.makeRequest()
}

DeviceTree.prototype.clearTimeout = function () {
  if (this.timeout !== null) {
    clearTimeout(this.timeout)
    this.timeout = null
  }
}

DeviceTree.prototype.finishRequest = function () {
  var self = this
  self.callback = undefined
  self.clearTimeout()
  self.activeRequest = null
  self.makeRequest()
}

DeviceTree.prototype.timeoutRequest = function (id) {
  var self = this
  self.root.cancelCallbacks()
  self.activeRequest(new errors.EmberTimeoutError(`Request ${id !== undefined ? id : ''} timed out`))
}

DeviceTree.prototype.handleRoot = function (root) {
  var self = this

  if (self._debug) { console.log('handling root', JSON.stringify(root)) }
  var callbacks = self.root.update(root)
  if (root.elements !== undefined) {
    for (var i = 0; i < root.elements.length; i++) {
      if (root.elements[i].isQualified()) {
        callbacks = callbacks.concat(this.handleQualifiedNode(this.root, root.elements[i]))
      } else {
        callbacks = callbacks.concat(this.handleNode(this.root, root.elements[i]))
      }
    }

    // Fire callbacks once entire tree has been updated
    /* eslint-disable no-redeclare */
    for (var i = 0; i < callbacks.length; i++) {
      // console.log('hr cb');
      callbacks[i]()
    }
  }
}

DeviceTree.prototype.handleQualifiedNode = function (parent, node) {
  var self = this
  var callbacks = []
  // console.log(`handling element with a path ${node.path}`);
  var element = parent.getElementByPath(node.path)
  if (element !== null) {
    // console.log("Found element", JSON.stringify(element));
    self.emit('value-change', node)
    callbacks = element.update(node)
  } else {
    // console.log("new element", JSON.stringify(node));
    var path = node.path.split('.')
    if (path.length === 1) {
      this.root.addChild(node)
    } else {
      // Let's try to get the parent
      path.pop()
      parent = this.root.getElementByPath(path.join('.'))
      if (parent === null) {
        return callbacks
      }
      parent.addChild(node)
    }
    element = node
  }

  var children = node.getChildren()
  if (children !== null) {
    for (var i = 0; i < children.length; i++) {
      if (children[i].isQualified()) {
        callbacks = callbacks.concat(this.handleQualifiedNode(element, children[i]))
      } else {
        callbacks = callbacks.concat(this.handleNode(element, children[i]))
      }
    }
  }

  // callbacks = parent.update();

  return callbacks
}

DeviceTree.prototype.handleNode = function (parent, node) {
  var self = this
  var callbacks = []

  var n = parent.getElementByNumber(node.number)
  if (n === null) {
    parent.addChild(node)
    n = node
  } else {
    callbacks = n.update(node)
  }

  var children = node.getChildren()
  if (children !== null) {
    for (var i = 0; i < children.length; i++) {
      callbacks = callbacks.concat(this.handleNode(n, children[i]))
    }
  } else {
    self.emit('value-change', node)
  }

  // console.log('handleNode: ', callbacks);
  return callbacks
}

DeviceTree.prototype.getNodeByPath = function (path) {
  var self = this
  if (typeof path === 'string') {
    path = path.split('/')
  }

  return new Promise((resolve, reject) => {
    self.addRequest((error) => {
      if (error) {
        reject(error)
        self.finishRequest()
        return
      }
      self.root.getNodeByPath(self.client, path, (error, node) => {
        if (error) {
          reject(error)
        } else {
          resolve(node)
        }
        self.finishRequest()
      })
    })
  })
}

DeviceTree.prototype.subscribe = function (node, callback) {
  if (node instanceof ember.Parameter && node.isStream()) {
    // TODO: implement
  } else {
    node.addCallback(callback)
  }
}

DeviceTree.prototype.unsubscribe = function (node, callback) {
  if (node instanceof ember.Parameter && node.isStream()) {
    // TODO: implement
  } else {
    node.addCallback(callback)
  }
}

DeviceTree.prototype.setValue = function (node, value) {
  var self = this
  return new Promise((resolve, reject) => {
    if ((!(node instanceof ember.Parameter)) &&
            (!(node instanceof ember.QualifiedParameter))) {
      reject(new errors.EmberAccessError('not a property'))
    } else {
      // if (this._debug) { console.log('setValue', node.getPath(), value); }
      self.addRequest((error) => {
        if (error) {
          self.finishRequest()
          reject(error)
          return
        }

        let cb = (error, node) => {
          // console.log('setValue complete...', node.getPath(), value);
          self.finishRequest()
          if (error) {
            reject(error)
          } else {
            resolve(node)
          }
        }

        self.callback = cb
        if (this._debug) { console.log('setValue sending ...', node.getPath(), value) }
        self.client.sendBERNode(node.setValue(value))
      })
    }
  })
}

module.exports = {DeviceTree, DecodeBuffer}
