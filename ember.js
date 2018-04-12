const BER = require('./ber.js')
const errors = require('./errors.js')
const util = require('util')
const Enum = require('enum')

const COMMAND_SUBSCRIBE = 30
const COMMAND_UNSUBSCRIBE = 31
const COMMAND_GETDIRECTORY = 32
module.exports.Subscribe = COMMAND_SUBSCRIBE
module.exports.Unsubscribe = COMMAND_UNSUBSCRIBE
module.exports.GetDirectory = COMMAND_GETDIRECTORY

var DEBUG = false

module.exports.DEBUG = function (d) {
  DEBUG = d
}

/****************************************************************************
 * Root
 ***************************************************************************/

function Root () {
  Root.super_.call(this)

  // Object.defineProperty(this, '_parent', {value: null, enumerable: false});
};

util.inherits(Root, TreeNode)

Root.decode = function (ber) {
  let r = new Root()
  let tag

  while (ber.remain > 0) {
    if (DEBUG) { console.log('Reading root') }
    ber = ber.getSequence(BER.APPLICATION(0))
    tag = ber.peek()
    if (DEBUG) { console.log('Application 0 start') }

    if (tag === BER.APPLICATION(11)) {
      if (DEBUG) { console.log('Application 11 start') }
      var seq = ber.getSequence(BER.APPLICATION(11))
      r.elements = []
      while (seq.remain > 0) {
        try {
          var rootReader = seq.getSequence(BER.CONTEXT(0))
          while (rootReader.remain > 0) {
            r.addElement(RootElement.decode(rootReader))
          }
        } catch (e) {
          console.log(e.stack)
          return r
        }
      }
    } else {
      // StreamCollection BER.APPLICATION(6)
      // InvocationResult BER.APPLICATION(23)
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  return r
}

Root.prototype.addElement = function (ele) {
  ele._parent = this
  if (this.elements === undefined) {
    this.elements = []
  }
  this.elements.push(ele)
}

Root.prototype.addChild = function (child) {
  this.addElement(child)
}

Root.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(0))

  if (this.elements !== undefined) {
    ber.startSequence(BER.APPLICATION(11))
    ber.startSequence(BER.CONTEXT(0))
    for (var i = 0; i < this.elements.length; i++) {
      this.elements[i].encode(ber)
    }
    ber.endSequence() // BER.CONTEXT(0)
    ber.endSequence()
  }

  ber.endSequence() // BER.APPLICATION(0)
}

Root.prototype.clear = function () {
  this.elements = undefined
}

Root.prototype.getChildren = function () {
  if (this.elements !== undefined) {
    return this.elements
  }
  return null
}

module.exports.Root = Root

/****************************************************************************
 * TreeNode (abstract)
 ***************************************************************************/

function TreeNode () {
  Object.defineProperty(this, '_parent', {value: null, enumerable: false, writable: true})
  Object.defineProperty(this, '_directoryCallbacks', {value: [], enumerable: false, writable: true})
  Object.defineProperty(this, '_callbacks', {value: [], enumerable: false, writable: true})
}

TreeNode.prototype.addChild = function (child) {
  child._parent = this
  if (this.children === undefined) {
    this.children = []
  }
  this.children.push(child)
}

TreeNode.prototype.isMatrix = function () {
  return ((this instanceof MatrixNode) || (this instanceof QualifiedMatrix))
}

TreeNode.prototype.isParameter = function () {
  return ((this instanceof Parameter) || (this instanceof QualifiedParameter))
}

TreeNode.prototype.isFunction = function () {
  return (this instanceof QualifiedFunction)
}

TreeNode.prototype.isQualified = function () {
  return ((this instanceof QualifiedParameter) ||
    (this instanceof QualifiedNode) ||
    (this instanceof QualifiedMatrix) ||
    (this instanceof QualifiedFunction))
}

TreeNode.prototype.isStream = function () {
  return this.contents !== undefined &&
        this.contents.streamDescriptor !== undefined
}

TreeNode.prototype.addCallback = function (callbacks) {
  if (this._callbacks.indexOf(callbacks) < 0) {
    this._callbacks.push(callbacks)
  }
}

TreeNode.prototype.cancelCallbacks = function () {
  var self = this
  self._directoryCallbacks = []
  var children = self.getChildren()
  if (children !== null) {
    for (var i = 0; i < children.length; i++) {
      children[i].cancelCallbacks()
    }
  }
}

TreeNode.prototype.getMinimal = function () {
  if (this.isQualified()) {
    return new this.constructor(this.path)
  } else {
    return new this.constructor(this.number)
  }
}

TreeNode.prototype.getTreeBranch = function (child, modifier) {
  var m = this.getMinimal()
  if (child !== undefined) {
    m.addChild(child)
  }

  if (modifier !== undefined) {
    modifier(m)
  }

  if (this._parent === null) {
    return m
  } else {
    var p = this._parent.getTreeBranch(m)
    return p
  }
}

TreeNode.prototype.getRoot = function () {
  if (this._parent === null) {
    return this
  } else {
    return this._parent.getRoot()
  }
}

TreeNode.prototype.getDirectory = function (callbacks) {
  if (callbacks !== undefined) {
    this._directoryCallbacks.push((error, node) => { callbacks(error, node) })
  }
  return this.getTreeBranch(new Command(COMMAND_GETDIRECTORY))
}

TreeNode.prototype.subscribe = function (callbacks) {
  if (callbacks !== undefined) {
    this._directoryCallbacks.push((error, node) => { callbacks(error, node) })
  }
  return this.getTreeBranch(new Command(COMMAND_SUBSCRIBE))
}

TreeNode.prototype.unsubscribe = function (callbacks) {
  if (callbacks !== undefined) {
    this._directoryCallbacks.push((error, node) => { callbacks(error, node) })
  }
  return this.getTreeBranch(new Command(COMMAND_UNSUBSCRIBE))
}

TreeNode.prototype.getChildren = function () {
  if (this.children !== undefined) {
    return this.children
  }
  return null
}

var _getElementByPath = function (children, pathArray, path) {
  if ((children === null) || (children === undefined) || (pathArray.length < 1)) {
    return null
  }
  var currPath = pathArray.join('.')
  var number = pathArray[pathArray.length - 1]
  // console.log(`looking for path ${currPath} or number ${number}`);

  for (var i = 0; i < children.length; i++) {
    // console.log("looking at child", JSON.stringify(children[i]));

    if ((children[i].path === currPath) ||
            (children[i].number === number)) {
      if (path.length === 0) {
        return children[i]
      }
      pathArray.push(path.splice(0, 1))
      return _getElementByPath(children[i].getChildren(), pathArray, path)
    }
  }

  return null
}

TreeNode.prototype.getElementByPath = function (path) {
  var children = this.getChildren()
  if ((children === null) || (children === undefined)) {
    return null
  }

  var myPath = this.getPath()
  if (path === myPath) {
    return this
  }
  var myPathArray = []
  if (this._parent) {
    myPathArray = myPath.split('.')
  }
  path = path.split('.')

  if (path.length > myPathArray.length) {
    var pathArray = path.splice(0, myPath.length + 1)
    for (var i = 0; i < pathArray.length - 1; i++) {
      if (pathArray[i] !== myPathArray[i]) {
        return null
      }
    }
  } else {
    return null
  }
  return _getElementByPath(children, pathArray, path)
}

TreeNode.prototype.getElementByNumber = function (index) {
  var children = this.getChildren()
  if (children === null) return null
  for (var i = 0; i < children.length; i++) {
    if (children[i].number === index) {
      return children[i]
    }
  }
  return null
}

TreeNode.prototype.getElementByIdentifier = function (identifier) {
  var children = this.getChildren()
  if (children === null) return null
  for (var i = 0; i < children.length; i++) {
    if (children[i].contents !== undefined &&
          children[i].contents.identifier === identifier) {
      return children[i]
    }
  }
  return null
}

TreeNode.prototype.getElement = function (id) {
  if (Number.isInteger(id)) {
    return this.getElementByNumber(id)
  } else {
    return this.getElementByIdentifier(id)
  }
}

TreeNode.prototype.update = function (other) {
  var self = this
  var callbacks = []

  // if(this.getChildren !== null) {
  while (self._directoryCallbacks.length > 0) {
    (function (cb) {
      callbacks.push(() => {
        // console.log(this.constructor.name, "dir cb", self.getPath());
        cb(null, self)
      })
    })(self._directoryCallbacks.shift())
  }
  // }

  for (var i = 0; i < self._callbacks.length; i++) {
    (function (cb) {
      callbacks.push(() => {
        // console.log(self.constructor.name, "cb", self.getPath());
        cb(self)
      })
    })(self._callbacks[i])
  }

  return callbacks
}

TreeNode.prototype.getNodeByPath = function (client, path, callbacks) {
  var self = this

  if (path.length === 0) {
    callbacks(null, self)
    return
  }

  var child = self.getElement(path[0])
  if (child !== null) {
    child.getNodeByPath(client, path.slice(1), callbacks)
  } else {
    var cmd = self.getDirectory((error, node) => {
      if (error) {
        callbacks(error)
      }
      child = node.getElement(path[0])
      if (child === null) {
        // console.log("inv:", path[0], self);
        callbacks('invalid path')
      } else {
        child.getNodeByPath(client, path.slice(1), callbacks)
      }
    })
    if (cmd !== null) {
      client.sendBERNode(cmd)
    }
  }
}

TreeNode.prototype.getPath = function () {
  if (this.path !== undefined) {
    return this.path
  }
  if (this._parent === null) {
    if (this.number === undefined) {
      return ''
    } else {
      return this.number.toString()
    }
  } else {
    var path = this._parent.getPath()
    if (path.length > 0) {
      path = path + '.'
    }
    return path + this.number
  }
}

/****************************************************************************
 * RootElement
 ***************************************************************************/

function RootElement () {};

RootElement.decode = function (ber) {
  return Element.decode(ber)

  // TODO: handle qualified types
}

/****************************************************************************
 * Element
 ***************************************************************************/

function Element () {};

Element.decode = function (ber) {
  var tag = ber.peek()
  if (tag === BER.APPLICATION(1)) {
    if (DEBUG) { console.log('Parameter decode') }
    return Parameter.decode(ber)
  } else if (tag === BER.APPLICATION(3)) {
    if (DEBUG) { console.log('Node decode') }
    return Node.decode(ber)
  } else if (tag === BER.APPLICATION(2)) {
    if (DEBUG) { console.log('Command decode') }
    return Command.decode(ber)
  } else if (tag === BER.APPLICATION(9)) {
    if (DEBUG) { console.log('QualifiedParameter decode') }
    return QualifiedParameter.decode(ber)
  } else if (tag === BER.APPLICATION(10)) {
    if (DEBUG) { console.log('QualifiedNode decode') }
    return QualifiedNode.decode(ber)
  } else if (tag === BER.APPLICATION(13)) {
    if (DEBUG) { console.log('MatrixNode decode') }
    return MatrixNode.decode(ber)
  } else if (tag === BER.APPLICATION(17)) {
    if (DEBUG) { console.log('QualifiedMatrix decode') }
    return QualifiedMatrix.decode(ber)
  } else if (tag === BER.APPLICATION(19)) {
    // Function
    throw new errors.UnimplementedEmberTypeError(tag)
  } else if (tag === BER.APPLICATION(20)) {
    return QualifiedFunction.decode(ber)
  } else if (tag === BER.APPLICATION(24)) {
    // Template
    throw new errors.UnimplementedEmberTypeError(tag)
  } else {
    throw new errors.UnimplementedEmberTypeError(tag)
  }
}

/****************************************************************************
 * ElementCollection
 ***************************************************************************/

/****************************************************************************
 * QualifiedNode
 ***************************************************************************/

function QualifiedNode (path) {
  QualifiedNode.super_.call(this)
  if (path !== undefined) {
    this.path = path
  }
}

util.inherits(QualifiedNode, TreeNode)

QualifiedNode.decode = function (ber) {
  var qn = new QualifiedNode()
  ber = ber.getSequence(BER.APPLICATION(10))
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      qn.path = seq.readRelativeOID(BER.EMBER_RELATIVE_OID) // 13 => relative OID
    } else if (tag === BER.CONTEXT(1)) {
      qn.contents = NodeContents.decode(seq)
    } else if (tag === BER.CONTEXT(2)) {
      qn.children = []
      seq = seq.getSequence(BER.APPLICATION(4))
      while (seq.remain > 0) {
        var nodeSeq = seq.getSequence(BER.CONTEXT(0))
        qn.addChild(Element.decode(nodeSeq))
      }
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  if (DEBUG) { console.log('QualifiedNode', qn) }
  return qn
}

QualifiedNode.prototype.update = function (other) {
  var callbacks = QualifiedNode.super_.prototype.update.apply(this)
  if ((other === undefined) && (other.contents !== undefined)) {
    // console.log("other: ", other.contents);
    for (var key in other.contents) {
      // console.log(key, other.contents.hasOwnProperty(key));
      if (other.contents.hasOwnProperty(key)) {
        this.contents[key] = other.contents[key]
      }
    }
  }
  return callbacks
}

function QualifiedNodeCommand (self, cmd, callbacks) {
  var r = new Root()
  var qn = new QualifiedNode()
  qn.path = self.path
  r.addElement(qn)
  qn.addChild(new Command(cmd))
  if (callbacks !== undefined) {
    self._directoryCallbacks.push((error, node) => { callbacks(error, node) })
  }
  return r
}

QualifiedNode.prototype.getDirectory = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedNodeCommand(this, COMMAND_GETDIRECTORY, callbacks)
}

QualifiedNode.prototype.subscribe = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedNodeCommand(this, COMMAND_SUBSCRIBE, callbacks)
}

QualifiedNode.prototype.unsubscribe = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedNodeCommand(this, COMMAND_UNSUBSCRIBE, callbacks)
}

QualifiedNode.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(10))

  ber.startSequence(BER.CONTEXT(0))
  ber.writeRelativeOID(this.path, BER.EMBER_RELATIVE_OID)
  ber.endSequence() // BER.CONTEXT(0)

  if (this.contents !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    this.contents.encode(ber)
    ber.endSequence() // BER.CONTEXT(1)
  }

  if (this.children !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.startSequence(BER.APPLICATION(4))
    for (var i = 0; i < this.children.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      this.children[i].encode(ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence()
  }

  ber.endSequence() // BER.APPLICATION(3)
}

module.exports.QualifiedNode = QualifiedNode

/****************************************************************************
 * Node
 ***************************************************************************/

function Node (number) {
  Node.super_.call(this)
  if (number !== undefined) { this.number = number }
};

util.inherits(Node, TreeNode)

Node.decode = function (ber) {
  var n = new Node()
  ber = ber.getSequence(BER.APPLICATION(3))

  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      n.number = seq.readInt()
    } else if (tag === BER.CONTEXT(1)) {
      n.contents = NodeContents.decode(seq)
    } else if (tag === BER.CONTEXT(2)) {
      seq = seq.getSequence(BER.APPLICATION(4))
      n.children = []
      while (seq.remain > 0) {
        var nodeSeq = seq.getSequence(BER.CONTEXT(0))
        n.addChild(Element.decode(nodeSeq))
      }
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  if (DEBUG) { console.log('Node', n) }
  return n
}

Node.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(3))

  ber.startSequence(BER.CONTEXT(0))
  ber.writeInt(this.number)
  ber.endSequence() // BER.CONTEXT(0)

  if (this.contents !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    this.contents.encode(ber)
    ber.endSequence() // BER.CONTEXT(1)
  }

  if (this.children !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.startSequence(BER.APPLICATION(4))
    for (var i = 0; i < this.children.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      this.children[i].encode(ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence()
  }

  ber.endSequence() // BER.APPLICATION(3)
}

Node.prototype.update = function (other) {
  var callbacks = Node.super_.prototype.update.apply(this)
  if ((other !== undefined) && (other.contents !== undefined)) {
    // console.log("other: ", other.contents);
    for (var key in other.contents) {
      // console.log(key, other.contents.hasOwnProperty(key));
      if (other.contents.hasOwnProperty(key)) {
        this.contents[key] = other.contents[key]
      }
    }
  }
  return callbacks
}

Node.prototype.subscribe = function (callbacks) {
  if (this._callbacks.indexOf(callbacks) < 0) {
    this._callbacks.push(callbacks)
  }
}

module.exports.Node = Node

/******************************
 * MATRIX
 ******************************/

function MatrixNode (number) {
  MatrixNode.super_.call(this)
  if (number !== undefined) { this.number = number }
}

MatrixNode.decode = function (ber) {
  var m = new MatrixNode()
  ber = ber.getSequence(BER.APPLICATION(13))
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      m.number = seq.readInt()
    } else if (tag === BER.CONTEXT(1)) {
      m.contents = MatrixContents.decode(seq)
    } else if (tag === BER.CONTEXT(2)) {
      m.children = []
      seq = seq.getSequence(BER.APPLICATION(4))
      while (seq.remain > 0) {
        var childSeq = seq.getSequence(BER.CONTEXT(0))
        m.addChild(Element.decode(childSeq))
      }
    } else if (tag === BER.CONTEXT(3)) {
      m.targets = decodeTargets(seq)
    } else if (tag === BER.CONTEXT(4)) {
      m.sources = decodeSources(seq)
    } else if (tag === BER.CONTEXT(5)) {
      m.connections = {}
      seq = seq.getSequence(BER.EMBER_SEQUENCE)
      while (seq.remain > 0) {
        var conSeq = seq.getSequence(BER.CONTEXT(0))
        var con = MatrixConnection.decode(conSeq)
        if (con.target !== undefined) {
          m.connections[con.target] = (con)
        }
      }
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  if (DEBUG) { console.log('MatrixNode', m) }
  return m
}

MatrixNode.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(13))

  ber.startSequence(BER.CONTEXT(0))
  ber.writeInt(this.number)
  ber.endSequence() // BER.CONTEXT(0)

  if (this.contents !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    this.contents.encode(ber)
    ber.endSequence() // BER.CONTEXT(1)
  }

  if (this.children !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.startSequence(BER.APPLICATION(4))
    for (var i = 0; i < this.children.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      this.children[i].encode(ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence()
  }

  if (this.targets !== undefined) {
    ber.startSequence(BER.CONTEXT(3))
    ber.startSequence(BER.EMBER_SEQUENCE)

    /* eslint-disable no-redeclare */
    for (var i = 0; i < this.targets.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      ber.startSequence(BER.APPLICATION(14))
      ber.startSequence(BER.CONTEXT(0))
      ber.writeInt(this.targets[i])
      ber.endSequence()
      ber.endSequence()
      ber.endSequence()
    }

    ber.endSequence()
    ber.endSequence()
  }

  if (this.sources !== undefined) {
    ber.startSequence(BER.CONTEXT(4))
    ber.startSequence(BER.EMBER_SEQUENCE)

    for (var i = 0; i < this.sources.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      ber.startSequence(BER.APPLICATION(15))
      ber.startSequence(BER.CONTEXT(0))
      ber.writeInt(this.sources[i])
      ber.endSequence()
      ber.endSequence()
      ber.endSequence()
    }

    ber.endSequence()
    ber.endSequence()
  }

  if (this.connections !== undefined) {
    ber.startSequence(BER.CONTEXT(5))
    for (var id in this.connections) {
      if (this.connections.hasOwnProperty(id)) {
        ber.startSequence(BER.CONTEXT(0))
        this.connections[id].encode(ber)
        ber.endSequence()
      }
    }
    ber.endSequence()
  }

  ber.endSequence() // BER.APPLICATION(3)
}

MatrixNode.prototype.update = function (other) {
  var callbacks = MatrixNode.super_.prototype.update.apply(this)
  MatrixUpdate(this, other)
  return callbacks
}

MatrixNode.prototype.connect = function (connections) {
  let r = this.getTreeBranch()
  let m = r.getElementByPath(this.getPath())
  m.connections = connections
  return r
}

util.inherits(MatrixNode, TreeNode)

module.exports.MatrixNode = MatrixNode

function MatrixContents () {
  this.type = MatrixType.oneToOne
  this.mode = MatrixMode.linear
}

MatrixContents.decode = function (ber) {
  var mc = new MatrixContents()

  // console.log("\n\n Matrix Content\n\n", ber.buffer);
  ber = ber.getSequence(BER.EMBER_SET)

  while (ber.remain > 0) {
    var tag = ber.peek()
    // console.log("Next tag", tag, ber.buffer);
    var seq = ber.getSequence(tag)

    if (tag === BER.CONTEXT(0)) {
      mc.identifier = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(1)) {
      mc.description = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(2)) {
      mc.type = MatrixType.get(seq.readInt())
    } else if (tag === BER.CONTEXT(3)) {
      mc.mode = MatrixMode.get(seq.readInt())
    } else if (tag === BER.CONTEXT(4)) {
      mc.targetCount = seq.readInt()
    } else if (tag === BER.CONTEXT(5)) {
      mc.sourceCount = seq.readInt()
    } else if (tag === BER.CONTEXT(6)) {
      mc.maximumTotalConnects = seq.readInt()
    } else if (tag === BER.CONTEXT(7)) {
      mc.maximumConnectsPerTarget = seq.readInt()
    } else if (tag === BER.CONTEXT(8)) {
      mc.parametersLocation = seq.readInt()
    } else if (tag === BER.CONTEXT(9)) {
      mc.gainParameterNumber = seq.readInt()
    } else if (tag === BER.CONTEXT(10)) {
      mc.labels = []
      // console.log("\n\nLABEL\n\n",seq.buffer);
      seq = seq.getSequence(BER.EMBER_SEQUENCE)
      while (seq.remain > 0) {
        var lSeq = seq.getSequence(BER.CONTEXT(0))
        mc.labels.push(Label.decode(lSeq))
      }
      // console.log(mc);
    } else if (tag === BER.CONTEXT(11)) {
      mc.schemaIdentifiers = seq.readInt()
    } else if (tag === BER.CONTEXT(12)) {
      mc.templateReference = seq.readRelativeOID(BER.EMBER_RELATIVE_OID)
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  // console.log("end of matrix contents");
  return mc
}

MatrixContents.prototype.encode = function (ber) {
  ber.startSequence(BER.EMBER_SET)
  if (this.identifier !== undefined) {
    ber.startSequence(BER.CONTEXT(0))
    ber.writeString(this.identifier, BER.EMBER_STRING)
    ber.endSequence()
  }
  if (this.description !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    ber.writeString(this.description, BER.EMBER_STRING)
    ber.endSequence()
  }
  if (this.type !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.writeInt(this.type.value)
    ber.endSequence()
  }
  if (this.mode !== undefined) {
    ber.startSequence(BER.CONTEXT(3))
    ber.writeInt(this.mode.value)
    ber.endSequence()
  }
  if (this.targetCount !== undefined) {
    ber.startSequence(BER.CONTEXT(4))
    ber.writeInt(this.targetCount)
    ber.endSequence()
  }
  if (this.sourceCount !== undefined) {
    ber.startSequence(BER.CONTEXT(5))
    ber.writeInt(this.sourceCount)
    ber.endSequence()
  }
  if (this.maximumTotalConnects !== undefined) {
    ber.startSequence(BER.CONTEXT(6))
    ber.writeInt(this.maximumTotalConnects)
    ber.endSequence()
  }
  if (this.maximumConnectsPerTarget !== undefined) {
    ber.startSequence(BER.CONTEXT(7))
    ber.writeInt(this.maximumConnectsPerTarget)
    ber.endSequence()
  }
  if (this.parametersLocation !== undefined) {
    ber.startSequence(BER.CONTEXT(8))
    ber.writeInt(this.parametersLocation)
    ber.endSequence()
  }
  if (this.gainParameterNumber !== undefined) {
    ber.startSequence(BER.CONTEXT(9))
    ber.writeInt(this.gainParameterNumber)
    ber.endSequence()
  }
  if (this.labels !== undefined) {
    ber.startSequence(BER.CONTEXT(10))
    ber.startSequence(BER.EMBER_SEQUENCE)
    for (var i = 0; i < this.labels.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      this.labels[i].encode(ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence()
  }
  if (this.schemaIdentifiers !== undefined) {
    ber.startSequence(BER.CONTEXT(11))
    ber.writeInt(this.schemaIdentifiers, BER.EMBER_STRING)
    ber.endSequence()
  }
  if (this.templateReference !== undefined) {
    ber.startSequence(BER.CONTEXT(12))
    ber.writeRelativeOID(this.templateReference, BER.EMBER_RELATIVE_OID)
    ber.endSequence()
  }
  ber.endSequence()
}

var decodeTargets = function (ber) {
  let targets = []

  ber = ber.getSequence(BER.EMBER_SEQUENCE)

  while (ber.remain > 0) {
    var seq = ber.getSequence(BER.CONTEXT(0))
    seq = seq.getSequence(BER.APPLICATION(14))
    seq = seq.getSequence(BER.CONTEXT(0))
    targets.push(seq.readInt())
  }

  return targets
}

var decodeSources = function (ber) {
  let sources = []

  ber = ber.getSequence(BER.EMBER_SEQUENCE)

  while (ber.remain > 0) {
    var seq = ber.getSequence(BER.CONTEXT(0))
    seq = seq.getSequence(BER.APPLICATION(15))
    seq = seq.getSequence(BER.CONTEXT(0))
    sources.push(seq.readInt())
  }

  return sources
}

module.exports.MatrixContents = MatrixContents

function MatrixConnection (target) {
  if (target) {
    target = Number(target)
    if (isNaN(target)) { target = 0 }
    this.target = target
  } else {
    this.target = 0
  }
}

// ConnectionOperation ::=
//     INTEGER {
//     absolute (0), -- default. sources contains absolute information
//     connect (1), -- nToN only. sources contains sources to add to connection
//     disconnect (2) -- nToN only. sources contains sources to remove from
//     connection
// }
var MatrixOperation = new Enum({
  absolute: 0,
  connect: 1,
  disconnect: 2
})

// ConnectionDisposition ::=
//     INTEGER {
//     tally (0), -- default
//     modified (1), -- sources contains new current state
//     pending (2), -- sources contains future state
//     locked (3) -- error: target locked. sources contains current state
//     -- more tbd.
// }
var MatrixDisposition = new Enum({
  tally: 0,
  modified: 1,
  pending: 2,
  locked: 3
})

module.exports.MatrixOperation = MatrixOperation
module.exports.MatrixDisposition = MatrixDisposition

MatrixConnection.prototype.setSources = function (sources) {
  if (sources === undefined) {
    delete this.sources
    return
  }
  let s = new Set(sources)
  this.sources = [...s].sort() // sources should be an array
}

MatrixConnection.prototype.connectSources = function (sources) {
  if (sources === undefined) {
    return
  }
  let s = new Set(this.sources)
  for (let item of sources) {
    s.add(item)
  }
  this.sources = [...s].sort()
}

MatrixConnection.prototype.disconnectSources = function (sources) {
  if (sources === undefined) {
    return
  }
  let s = new Set(this.sources)
  for (let item of sources) {
    s.delete(item)
  }
  this.sources = [...s].sort()
}

MatrixConnection.decode = function (ber) {
  var c = new MatrixConnection()
  ber = ber.getSequence(BER.APPLICATION(16))
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      c.target = seq.readInt()
    } else if (tag === BER.CONTEXT(1)) {
      // sources
      var sources = seq.readRelativeOID(BER.EMBER_RELATIVE_OID)
      c.sources = sources.split('.')
    } else if (tag === BER.CONTEXT(2)) {
      c.operation = MatrixOperation.get(seq.readInt())
    } else if (tag === BER.CONTEXT(3)) {
      c.disposition = MatrixDisposition.get(seq.readInt())
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  return c
}

MatrixConnection.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(16))

  ber.startSequence(BER.CONTEXT(0))
  ber.writeInt(this.target)
  ber.endSequence()

  if ((this.sources !== undefined) && (this.sources.length > 0)) {
    ber.startSequence(BER.CONTEXT(1))
    ber.writeRelativeOID(this.sources.join('.'), BER.EMBER_RELATIVE_OID)
    ber.endSequence()
  }
  if (this.operation !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.writeInt(this.operation.value)
    ber.endSequence()
  }
  if (this.disposition !== undefined) {
    ber.startSequence(BER.CONTEXT(3))
    ber.writeInt(this.disposition.value)
    ber.endSequence()
  }
  ber.endSequence()
}

module.exports.MatrixConnection = MatrixConnection

function Label (path) {
  if (path) {
    this.basePath = path
  }
}

Label.decode = function (ber) {
  var l = new Label()

  ber = ber.getSequence(BER.APPLICATION(18))

  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      l.basePath = seq.readRelativeOID(BER.EMBER_RELATIVE_OID)
    } else if (tag === BER.CONTEXT(1)) {
      l.description = seq.readString(BER.EMBER_STRING)
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  return l
}

Label.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(18))
  if (this.basePath !== undefined) {
    ber.startSequence(BER.CONTEXT(0))
    ber.writeRelativeOID(this.basePath, BER.EMBER_RELATIVE_OID)
    ber.endSequence()
  }
  if (this.description !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    ber.writeString(this.description, BER.EMBER_STRING)
    ber.endSequence()
  }
  ber.endSequence()
}

module.exports.Label = Label

function ParametersLocation () {
}

ParametersLocation.decode = function (ber) {
  var tag = ber.peek()
  ber = ber.getSequence(tag)
  this.value = ber.readValue()
}

module.exports.ParametersLocation = ParametersLocation

var MatrixType = new Enum({
  oneToN: 0,
  oneToOne: 1,
  nToN: 2
})

module.exports.MatrixType = MatrixType

var MatrixMode = new Enum({
  linear: 0,
  nonLinear: 1
})

module.exports.MatrixMode = MatrixMode

/****************************************************************************
 * QualifiedMatrix
 ***************************************************************************/

function QualifiedMatrix (path) {
  QualifiedMatrix.super_.call(this)
  if (path !== undefined) {
    this.path = path
  }
}

util.inherits(QualifiedMatrix, TreeNode)

QualifiedMatrix.decode = function (ber) {
  var qm = new QualifiedMatrix()
  ber = ber.getSequence(BER.APPLICATION(17))
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      qm.path = seq.readRelativeOID(BER.EMBER_RELATIVE_OID) // 13 => relative OID
    } else if (tag === BER.CONTEXT(1)) {
      qm.contents = MatrixContents.decode(seq)
    } else if (tag === BER.CONTEXT(2)) {
      qm.children = []
      seq = seq.getSequence(BER.APPLICATION(4))
      while (seq.remain > 0) {
        var nodeSeq = seq.getSequence(BER.CONTEXT(0))
        qm.addChild(Element.decode(nodeSeq))
      }
    } else if (tag === BER.CONTEXT(3)) {
      qm.targets = decodeTargets(seq)
    } else if (tag === BER.CONTEXT(4)) {
      qm.sources = decodeSources(seq)
    } else if (tag === BER.CONTEXT(5)) {
      qm.connections = {}
      seq = seq.getSequence(BER.EMBER_SEQUENCE)
      while (seq.remain > 0) {
        var conSeq = seq.getSequence(BER.CONTEXT(0))
        var con = MatrixConnection.decode(conSeq)
        if (con.target !== undefined) {
          qm.connections[con.target] = con
        }
      }
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  if (DEBUG) { console.log('QualifiedMatrix', qm) }
  return qm
}

function MatrixUpdate (matrix, newMatrix) {
  if (newMatrix !== undefined) {
    if (newMatrix.contents !== undefined) {
      for (var key in newMatrix.contents) {
        // console.log(key, other.contents.hasOwnProperty(key));
        if (newMatrix.contents.hasOwnProperty(key)) {
          matrix.contents[key] = newMatrix.contents[key]
        }
      }
    }
    if (newMatrix.targets !== undefined) {
      matrix.targets = newMatrix.targets
    }
    if (newMatrix.sources !== undefined) {
      matrix.sources = newMatrix.sources
    }
    if (newMatrix.connections !== undefined) {
      if (matrix.connections === undefined) {
        matrix.connections = {}
      }
      for (let id in newMatrix.connections) {
        if (newMatrix.connections.hasOwnProperty(id)) {
          let connection = newMatrix.connections[id]
          if ((connection.target < matrix.contents.targetCount) &&
                        (connection.target >= 0)) {
            matrix.connections[connection.target].setSources(connection.sources)
          }
        }
      }
    }
  }
}

QualifiedMatrix.prototype.update = function (other) {
  var callbacks = QualifiedMatrix.super_.prototype.update.apply(this)
  MatrixUpdate(this, other)
  return callbacks
}

function QualifiedMatrixCommand (self, cmd, callbacks) {
  var r = new Root()
  var qn = new QualifiedMatrix()
  qn.path = self.path
  r.addElement(qn)
  qn.addChild(new Command(cmd))
  if (callbacks !== undefined) {
    self._directoryCallbacks.push((error, node) => { callbacks(error, node) })
  }
  return r
}

QualifiedMatrix.prototype.getDirectory = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedMatrixCommand(this, COMMAND_GETDIRECTORY, callbacks)
}

QualifiedMatrix.prototype.subscribe = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedMatrixCommand(this, COMMAND_SUBSCRIBE, callbacks)
}

QualifiedMatrix.prototype.unsubscribe = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedMatrixCommand(this, COMMAND_UNSUBSCRIBE, callbacks)
}

QualifiedMatrix.prototype.connect = function (connections) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  var r = new Root()
  var qn = new QualifiedMatrix()
  qn.path = this.path
  r.addElement(qn)
  qn.connections = connections
  return r
}

QualifiedMatrix.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(17))

  ber.startSequence(BER.CONTEXT(0))
  ber.writeRelativeOID(this.path, BER.EMBER_RELATIVE_OID)
  ber.endSequence() // BER.CONTEXT(0)

  if (this.contents !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    this.contents.encode(ber)
    ber.endSequence() // BER.CONTEXT(1)
  }

  if (this.children !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.startSequence(BER.APPLICATION(4))
    for (var i = 0; i < this.children.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      this.children[i].encode(ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence()
  }

  if (this.targets !== undefined) {
    ber.startSequence(BER.CONTEXT(3))

    for (var i = 0; i < this.targets.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      ber.startSequence(BER.APPLICATION(14))
      ber.startSequence(BER.CONTEXT(0))
      ber.writeInt(this.targets[i])
      ber.endSequence()
      ber.endSequence()
      ber.endSequence()
    }

    ber.endSequence()
  }

  if (this.sources !== undefined) {
    ber.startSequence(BER.CONTEXT(4))

    for (var i = 0; i < this.sources.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      ber.startSequence(BER.APPLICATION(15))
      ber.startSequence(BER.CONTEXT(0))
      ber.writeInt(this.sources[i])
      ber.endSequence()
      ber.endSequence()
      ber.endSequence()
    }

    ber.endSequence()
  }

  if (this.connections !== undefined) {
    ber.startSequence(BER.CONTEXT(5))
    ber.startSequence(BER.EMBER_SEQUENCE)
    for (var id in this.connections) {
      if (this.connections.hasOwnProperty(id)) {
        ber.startSequence(BER.CONTEXT(0))
        this.connections[id].encode(ber)
        ber.endSequence()
      }
    }
    ber.endSequence()
    ber.endSequence()
  }

  ber.endSequence() // BER.APPLICATION(3)
}

module.exports.QualifiedMatrix = QualifiedMatrix

/****************************************************************************
 * FunctionContent
 ***************************************************************************/

function FunctionContent () {
}

var decodeTupleDescription = function (ber) {
  var tuple = {}
  ber = ber.getSequence(BER.APPLICATION(21))
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      tuple.type = seq.readInt()
    } else if (tag === BER.CONTEXT(1)) {
      tuple.name = seq.readString(BER.EMBER_STRING)
    }
  }
  return tuple
}

var encodeTupleDescription = function (tuple, ber) {
  ber.startSequence(BER.APPLICATION(21))
  if (tuple.type !== undefined) {
    ber.startSequence(BER.CONTEXT(0))
    ber.writeInt(tuple.type)
    ber.endSequence()
  }
  if (tuple.name !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    ber.writeString(tuple.name)
    ber.endSequence()
  }
  ber.endSequence()
}

FunctionContent.decode = function (ber) {
  var fc = new FunctionContent()
  ber = ber.getSequence(BER.EMBER_SET)
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      fc.identifier = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(1)) {
      fc.description = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(2)) {
      fc.arguments = []
      seq = seq.getSequence(BER.EMBER_SEQUENCE)
      while (seq.remain > 0) {
        tag = seq.peek()
        var dataSeq = seq.getSequence(BER.CONTEXT(0))
        if (tag === BER.CONTEXT(0)) {
          fc.arguments.push(decodeTupleDescription(dataSeq))
        }
      }
    } else if (tag === BER.CONTEXT(3)) {
      fc.result = []
      while (seq.remain > 0) {
        tag = seq.peek()
        var dataSeq = seq.getSequence(tag)
        if (tag === BER.CONTEXT(0)) {
          fc.result.push(decodeTupleDescription(dataSeq))
        }
      }
    } else if (tag === BER.CONTEXT(4)) {
      fc.templateReference = seq.readRelativeOID(BER.EMBER_RELATIVE_OID)
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }

  return fc
}

FunctionContent.prototype.encode = function (ber) {
  ber.startSequence(BER.EMBER_SET)

  if (this.identifier !== undefined) {
    ber.startSequence(BER.CONTEXT(0))
    ber.writeString(this.identifier, BER.EMBER_STRING)
    ber.endSequence() // BER.CONTEXT(0)
  }

  if (this.description !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    ber.writeString(this.description, BER.EMBER_STRING)
    ber.endSequence() // BER.CONTEXT(1)
  }

  if (this.arguments !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.startSequence(BER.EMBER_SEQUENCE)
    for (var i = 0; i < this.arguments; i++) {
      ber.startSequence(BER.CONTEXT(0))
      encodeTupleDescription(this.arguments[i], ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence() // BER.CONTEXT(2)
  }

  if (this.result !== undefined) {
    ber.startSequence(BER.CONTEXT(3))
    ber.startSequence(BER.EMBER_SEQUENCE)
    for (var i = 0; i < this.result; i++) {
      ber.startSequence(BER.CONTEXT(0))
      encodeTupleDescription(this.result[i], ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence() // BER.CONTEXT(3)
  }

  ber.endSequence() // BER.EMBER_SET
}

module.exports.FunctionContent = FunctionContent

/****************************************************************************
 * QualifiedFunction
 ***************************************************************************/

function QualifiedFunction (path) {
  QualifiedFunction.super_.call(this)
  if (path !== undefined) {
    this.path = path
  }
}

util.inherits(QualifiedFunction, TreeNode)

QualifiedFunction.decode = function (ber) {
  var qf = new QualifiedFunction()
  ber = ber.getSequence(BER.APPLICATION(20))
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      qf.path = seq.readRelativeOID(BER.EMBER_RELATIVE_OID) // 13 => relative OID
    } else if (tag === BER.CONTEXT(1)) {
      qf.contents = FunctionContent.decode(seq)
    } else if (tag === BER.CONTEXT(2)) {
      qf.children = []
      seq = seq.getSequence(BER.APPLICATION(4))
      while (seq.remain > 0) {
        var nodeSeq = seq.getSequence(BER.CONTEXT(0))
        qf.addChild(Element.decode(nodeSeq))
      }
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  return qf
}

QualifiedFunction.prototype.update = function (other) {
  var callbacks = QualifiedFunction.super_.prototype.update.apply(this)
  if ((other !== undefined) && (other.contents !== undefined)) {
    // console.log("other: ", other.contents);
    for (var key in other.contents) {
      // console.log(key, other.contents.hasOwnProperty(key));
      if (other.contents.hasOwnProperty(key)) {
        this.contents[key] = other.contents[key]
      }
    }
  }
  return callbacks
}

function QualifiedFunctionCommand (self, cmd, callbacks) {
  var r = new Root()
  var qf = new QualifiedFunction()
  qf.path = self.path
  r.addElement(qf)
  qf.addChild(new Command(cmd))
  if (callbacks !== undefined) {
    self._directoryCallbacks.push((error, node) => { callbacks(error, node) })
  }
  return r
}

QualifiedFunction.prototype.getDirectory = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedFunctionCommand(this, COMMAND_GETDIRECTORY, callbacks)
}

QualifiedFunction.prototype.subscribe = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedFunctionCommand(this, COMMAND_SUBSCRIBE, callbacks)
}

QualifiedFunction.prototype.unsubscribe = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedFunctionCommand(this, COMMAND_UNSUBSCRIBE, callbacks)
}

QualifiedFunction.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(20))

  ber.startSequence(BER.CONTEXT(0))
  ber.writeRelativeOID(this.path, BER.EMBER_RELATIVE_OID)
  ber.endSequence() // BER.CONTEXT(0)

  if (this.contents !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    this.contents.encode(ber)
    ber.endSequence() // BER.CONTEXT(1)
  }

  if (this.children !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.startSequence(BER.APPLICATION(4))
    for (var i = 0; i < this.children.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      this.children[i].encode(ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence()
  }

  ber.endSequence() // BER.APPLICATION(3)
}

module.exports.QualifiedFunction = QualifiedFunction

/****************************************************************************
 * NodeContents
 ***************************************************************************/

function NodeContents () {
  this.isOnline = true
};

NodeContents.decode = function (ber) {
  var nc = new NodeContents()
  ber = ber.getSequence(BER.EMBER_SET)
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      nc.identifier = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(1)) {
      nc.description = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(2)) {
      nc.isRoot = seq.readBoolean()
    } else if (tag === BER.CONTEXT(3)) {
      nc.isOnline = seq.readBoolean()
    } else if (tag === BER.CONTEXT(4)) {
      nc.schemaIdentifiers = seq.readString(BER.EMBER_STRING)
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }

  return nc
}

NodeContents.prototype.encode = function (ber) {
  ber.startSequence(BER.EMBER_SET)

  if (this.identifier !== undefined) {
    ber.startSequence(BER.CONTEXT(0))
    ber.writeString(this.identifier, BER.EMBER_STRING)
    ber.endSequence() // BER.CONTEXT(0)
  }

  if (this.description !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    ber.writeString(this.description, BER.EMBER_STRING)
    ber.endSequence() // BER.CONTEXT(1)
  }

  if (this.isRoot !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.writeBoolean(this.isRoot)
    ber.endSequence() // BER.CONTEXT(2)
  }

  if (this.isOnline !== undefined) {
    ber.startSequence(BER.CONTEXT(3))
    ber.writeBoolean(this.isOnline)
    ber.endSequence() // BER.CONTEXT(3)
  }

  if (this.schemaIdentifiers !== undefined) {
    ber.startSequence(BER.CONTEXT(4))
    ber.writeString(this.schemaIdentifiers, BER.EMBER_STRING)
    ber.endSequence() // BER.CONTEXT(4)
  }

  ber.endSequence() // BER.EMBER_SET
}

module.exports.NodeContents = NodeContents

/****************************************************************************
 * Command
 ***************************************************************************/

function Command (number) {
  if (number !== undefined) { this.number = number }
  this.fieldFlags = FieldFlags.all
}

var FieldFlags = new Enum({
  sparse: -2,
  all: -1,
  default: 0,
  identifier: 1,
  description: 2,
  tree: 3,
  value: 4,
  connections: 5
})

Command.decode = function (ber) {
  var c = new Command()
  ber = ber.getSequence(BER.APPLICATION(2))

  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      c.number = seq.readInt()
    } else if (tag === BER.CONTEXT(1)) {
      c.fieldFlags = FieldFlags.get(seq.readInt())
    } else if (tag === BER.CONTEXT(2)) {
      c.invocation = Invocation.decode(ber)
    } else {
      // TODO: options
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }

  return c
}

Command.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(2))

  ber.startSequence(BER.CONTEXT(0))
  ber.writeInt(this.number)
  ber.endSequence() // BER.CONTEXT(0)

  if (this.fieldFlags) {
    ber.startSequence(BER.CONTEXT(1))
    ber.writeInt(this.fieldFlags.value)
    ber.endSequence()
  }

  if (this.invocation) {
    ber.startSequence(BER.CONTEXT(2))
    this.invocation.encode(ber)
    ber.endSequence()
  }
  // TODO: options

  ber.endSequence() // BER.APPLICATION(2)
}

module.exports.Command = Command

/****************************************************************************
 * Invocation
 ***************************************************************************/
function Invocation () {
  Invocation.super_.call(this)
}

Invocation.decode = function (ber) {
  let invocation = new Invocation()
  ber = ber.getSequence(BER.APPLICATION(22))
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      invocation.invocationId = seq.readInt()
    }
    if (tag === BER.CONTEXT(1)) {
      invocation.arguments = []
      let seq = ber.getSequence(BER.EMBER_SEQUENCE)
      while (seq.remain > 0) {
        tag = seq.peek()
        var dataSeq = seq.getSequence(BER.CONTEXT(0))
        if (tag === BER.CONTEXT(0)) {
          invocation.arguments.push(dataSeq.readValue())
        }
      }
    } else {
      // TODO: options
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }

  return invocation
}

Invocation.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(22))
  ber.startSequence(BER.EMBER_SEQUENCE)

  for (var i = 0; i < this.arguments; i++) {
    ber.startSequence(BER.CONTEXT(0))
    ber.writeValue(this.arguments[i])
    ber.endSequence()
  }

  ber.endSequence()

  ber.endSequence() // BER.APPLICATION(22)
}
/****************************************************************************
 * QualifiedParameter
 ***************************************************************************/

function QualifiedParameter (path) {
  QualifiedParameter.super_.call(this)
  if (path !== undefined) { this.path = path }
}

util.inherits(QualifiedParameter, TreeNode)
module.exports.QualifiedParameter = QualifiedParameter

QualifiedParameter.decode = function (ber) {
  // console.log("Decoding QualifiedParameter");
  var qp = new QualifiedParameter()
  ber = ber.getSequence(BER.APPLICATION(9))
  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      qp.path = seq.readRelativeOID(BER.EMBER_RELATIVE_OID) // 13 => relative OID
      // console.log("Decoded path",qp.path);
    } else if (tag === BER.CONTEXT(1)) {
      // console.log("Decoding content");
      qp.contents = ParameterContents.decode(seq)
      // console.log("Decoded content",qp.contents);
    } else if (tag === BER.CONTEXT(2)) {
      qp.children = []
      // console.log("Decoding children");
      seq = seq.getSequence(BER.APPLICATION(4))
      while (seq.remain > 0) {
        var nodeSeq = seq.getSequence(BER.CONTEXT(0))
        qp.addChild(Element.decode(nodeSeq))
      }
    } else {
      return qp
      // throw new errors.UnimplementedEmberTypeError(tag);
    }
  }
  if (DEBUG) { console.log('QualifiedParameter', qp) }
  return qp
}

QualifiedParameter.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(9))

  ber.startSequence(BER.CONTEXT(0))
  ber.writeRelativeOID(this.path, BER.EMBER_RELATIVE_OID)
  ber.endSequence() // BER.CONTEXT(0)

  if (this.contents !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    this.contents.encode(ber)
    ber.endSequence() // BER.CONTEXT(1)
  }

  if (this.children !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.startSequence(BER.APPLICATION(4))
    for (var i = 0; i < this.children.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      this.children[i].encode(ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence()
  }

  ber.endSequence() // BER.APPLICATION(3)
}

QualifiedParameter.prototype.update = function (other) {
  var callbacks = QualifiedParameter.super_.prototype.update.apply(this)
  if ((other !== undefined) && (other.contents !== undefined)) {
    // console.log("other: ", other.contents);
    for (var key in other.contents) {
      // console.log(key, other.contents.hasOwnProperty(key));
      if (other.contents.hasOwnProperty(key)) {
        this.contents[key] = other.contents[key]
      }
    }
  }
  return callbacks
}

function QualifiedParameterCommand (self, cmd, callbacks) {
  let r = new Root()
  let qp = new QualifiedParameter()
  qp.path = self.path
  r.addElement(qp)
  qp.addChild(new Command(cmd))
  if (callbacks !== undefined) {
    self._directoryCallbacks.push((error, node) => { callbacks(error, node) })
  }
  return r
}

QualifiedParameter.prototype.getDirectory = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedParameterCommand(this, COMMAND_GETDIRECTORY, callbacks)
}

QualifiedParameter.prototype.subscribe = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedParameterCommand(this, COMMAND_SUBSCRIBE, callbacks)
}

QualifiedParameter.prototype.unsubscribe = function (callbacks) {
  if (this.path === undefined) {
    throw new Error('Invalid path')
  }
  return QualifiedParameterCommand(this, COMMAND_UNSUBSCRIBE, callbacks)
}

QualifiedParameter.prototype.setValue = function (value, callbacks) {
  if (callbacks !== undefined) {
    this._directoryCallbacks.push(callbacks)
  }

  let r = new Root()
  let qp = new QualifiedParameter(this.path)
  r.addElement(qp)
  qp.contents = new ParameterContents(value)
  return r
}

/****************************************************************************
 * Parameter
 ***************************************************************************/

function Parameter (number) {
  Parameter.super_.call(this)
  if (number !== undefined) { this.number = number }
}

util.inherits(Parameter, TreeNode)
module.exports.Parameter = Parameter

Parameter.decode = function (ber) {
  var p = new Parameter()
  ber = ber.getSequence(BER.APPLICATION(1))

  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      p.number = seq.readInt()
    } else if (tag === BER.CONTEXT(1)) {
      p.contents = ParameterContents.decode(seq)
    } else if (tag === BER.CONTEXT(2)) {
      seq = seq.getSequence(BER.APPLICATION(4))
      p.children = []
      while (seq.remain > 0) {
        var paramSeq = seq.getSequence(BER.CONTEXT(0))
        p.addChild(Element.decode(paramSeq))
      }
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  if (DEBUG) { console.log('Parameter', p) }
  return p
}

Parameter.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(1))

  ber.writeIfDefined(this.number, ber.writeInt, 0)

  if (this.contents !== undefined) {
    ber.startSequence(BER.CONTEXT(1))
    this.contents.encode(ber)
    ber.endSequence()
  }

  if (this.children !== undefined) {
    ber.startSequence(BER.CONTEXT(2))
    ber.startSequence(BER.APPLICATION(4))
    for (var i = 0; i < this.children.length; i++) {
      ber.startSequence(BER.CONTEXT(0))
      this.children[i].encode(ber)
      ber.endSequence()
    }
    ber.endSequence()
    ber.endSequence()
  }

  ber.endSequence()
}

Parameter.prototype.setValue = function (value, callbacks) {
  if (callbacks !== undefined) {
    this._directoryCallbacks.push(callbacks)
  }

  return this.getTreeBranch(undefined, (m) => {
    m.contents = new ParameterContents(value)
  })
}

Parameter.prototype.update = function (other) {
  var callbacks = Parameter.super_.prototype.update.apply(this)
  // console.log('update', this.getPath());
  // console.log(callbacks);
  if ((other !== undefined) && (other.contents !== undefined)) {
    // console.log("other: ", other.contents);
    for (var key in other.contents) {
      // console.log(key, other.contents.hasOwnProperty(key));
      if (other.contents.hasOwnProperty(key)) {
        this.contents[key] = other.contents[key]
      }
    }
  }
  return callbacks
}

var ParameterAccess = new Enum({
  none: 0,
  read: 1,
  write: 2,
  readWrite: 3
})

var ParameterType = new Enum({
  integer: 1,
  real: 2,
  string: 3,
  boolean: 4,
  trigger: 5,
  enum: 6,
  octets: 7
})

module.exports.ParameterAccess = ParameterAccess
module.exports.ParameterType = ParameterType

function ParameterContents (value) {
  if (value !== undefined) {
    this.value = value
  }
};

module.exports.ParameterContents = ParameterContents

ParameterContents.decode = function (ber) {
  var pc = new ParameterContents()
  ber = ber.getSequence(BER.EMBER_SET)

  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      pc.identifier = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(1)) {
      pc.description = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(2)) {
      pc.value = seq.readValue()
    } else if (tag === BER.CONTEXT(3)) {
      pc.minimum = seq.readValue()
    } else if (tag === BER.CONTEXT(4)) {
      pc.maximum = seq.readValue()
    } else if (tag === BER.CONTEXT(5)) {
      pc.access = ParameterAccess.get(seq.readInt())
    } else if (tag === BER.CONTEXT(6)) {
      pc.format = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(7)) {
      pc.enumeration = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(8)) {
      pc.factor = seq.readInt()
    } else if (tag === BER.CONTEXT(9)) {
      pc.isOnline = seq.readBoolean()
    } else if (tag === BER.CONTEXT(10)) {
      pc.formula = seq.readString(BER.EMBER_STRING)
    } else if (tag === BER.CONTEXT(11)) {
      pc.step = seq.readInt()
    } else if (tag === BER.CONTEXT(12)) {
      pc.default = seq.readValue()
    } else if (tag === BER.CONTEXT(13)) {
      pc.type = ParameterType.get(seq.readInt())
    } else if (tag === BER.CONTEXT(14)) {
      pc.streamIdentifier = seq.readInt()
    } else if (tag === BER.CONTEXT(15)) {
      pc.enumMap = StringIntegerCollection.decode(seq)
    } else if (tag === BER.CONTEXT(16)) {
      pc.streamDescriptor = StreamDescription.decode(seq)
    } else if (tag === BER.CONTEXT(17)) {
      pc.schemaIdentifiers = seq.readString(BER.EMBER_STRING)
    } else if (tag === null) {
      break
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }
  return pc
}

ParameterContents.prototype.encode = function (ber) {
  ber.startSequence(BER.EMBER_SET)

  ber.writeIfDefined(this.identifier, ber.writeString, 0, BER.EMBER_STRING)
  ber.writeIfDefined(this.description, ber.writeString, 1, BER.EMBER_STRING)
  ber.writeIfDefined(this.value, ber.writeValue, 2)
  ber.writeIfDefined(this.minimum, ber.writeValue, 3)
  ber.writeIfDefined(this.maximum, ber.writeValue, 4)
  ber.writeIfDefinedEnum(this.access, ParameterAccess, ber.writeInt, 5)
  ber.writeIfDefined(this.format, ber.writeString, 6, BER.EMBER_STRING)
  ber.writeIfDefined(this.enumeration, ber.writeString, 7, BER.EMBER_STRING)
  ber.writeIfDefined(this.factor, ber.writeInt, 8)
  ber.writeIfDefined(this.isOnline, ber.writeBoolean, 9)
  ber.writeIfDefined(this.formula, ber.writeString, 10, BER.EMBER_STRING)
  ber.writeIfDefined(this.step, ber.writeInt, 11)
  ber.writeIfDefined(this.default, ber.writeValue, 12)
  ber.writeIfDefinedEnum(this.type, ParameterType, ber.writeInt, 13)
  ber.writeIfDefined(this.streamIdentifier, ber.writeInt, 14)

  if (this.emumMap !== undefined) {
    ber.startSequence(BER.CONTEXT(15))
    StringIntegerCollection.encode(ber, this.enumMap)
    ber.endSequence()
  }

  if (this.streamDescriptor !== undefined) {
    ber.startSequence(BER.CONTEXT(16))
    this.streamDescriptor.encode(ber)
    ber.endSequence()
  }

  ber.writeIfDefined(this.schemaIdentifiers, ber.writeString, 17, BER.EMBER_STRING)

  ber.endSequence()
}

/****************************************************************************
 * StringIntegerCollection
 ***************************************************************************/

// This is untested, VPB doesn't seem to use this that I've seen so far

function StringIntegerCollection () {};

StringIntegerCollection.decode = function (ber) {
  var enumMap = {}
  ber = ber.getSequence(BER.APPLICATION(8))
  while (ber.remain > 0) {
    var seq = ber.getSequence(BER.CONTEXT(0))
    seq = seq.getSequence(BER.APPLICATION(7))
    var entryString, entryInteger
    while (seq.remain > 0) {
      var tag = seq.peek()
      var dataSeq = seq.getSequence(tag)
      if (tag === BER.CONTEXT(0)) {
        entryString = dataSeq.readString(BER.EMBER_STRING)
      } else if (tag === BER.CONTEXT(1)) {
        entryInteger = dataSeq.readInt()
      } else {
        throw new errors.UnimplementedEmberTypeError(tag)
      }
    }

    enumMap[entryString] = entryInteger
  }

  return new Enum(enumMap)
}

StringIntegerCollection.encode = function (ber, e) {
  ber.startSequence(BER.APPLICATION(8))
  ber.startSequence(BER.CONTEXT(0))
  e.enums.forEach((item) => {
    ber.startSequence(BER.APPLICATION(7))
    ber.startSequence(BER.CONTEXT(0))
    ber.writeString(item.key, BER.EMBER_STRING)
    ber.endSequence()
    ber.startSequence(BER.CONTEXT(1))
    ber.writeInt(item.value)
    ber.endSequence()
    ber.endSequence()
  })
  ber.endSequence()
  ber.endSequence()
}

/****************************************************************************
 * StreamDescription
 ***************************************************************************/

var StreamFormat = new Enum({
  unsignedInt8: 0,
  unsignedInt16BigEndian: 2,
  unsignedInt16LittleEndian: 3,
  unsignedInt32BigEndian: 4,
  unsignedInt32LittleEndian: 5,
  unsignedInt64BigEndian: 6,
  unsignedInt64LittleENdian: 7,
  signedInt8: 8,
  signedInt16BigEndian: 10,
  signedInt16LittleEndian: 11,
  signedInt32BigEndian: 12,
  signedInt32LittleEndian: 13,
  signedInt64BigEndian: 14,
  signedInt64LittleEndian: 15,
  ieeeFloat32BigEndian: 20,
  ieeeFloat32LittleEndian: 21,
  ieeeFloat64BigEndian: 22,
  ieeeFloat64LittleEndian: 23
})

function StreamDescription () {};

StreamDescription.decode = function (ber) {
  var sd = new StreamDescription()
  ber = ber.getSequence(BER.APPLICATION(12))

  while (ber.remain > 0) {
    var tag = ber.peek()
    var seq = ber.getSequence(tag)
    if (tag === BER.CONTEXT(0)) {
      sd.format = StreamFormat.get(seq.readInt())
    } else if (tag === BER.CONTEXT(1)) {
      sd.offset = seq.readInt()
    } else {
      throw new errors.UnimplementedEmberTypeError(tag)
    }
  }

  return sd
}

StreamDescription.prototype.encode = function (ber) {
  ber.startSequence(BER.APPLICATION(12))

  ber.writeIfDefinedEnum(this.format, StreamFormat, ber.writeInt, 0)
  ber.writeIfDefined(this.offset, ber.writeInt, 1)

  ber.endSequence()
}
