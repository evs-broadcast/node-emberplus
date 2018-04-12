const util = require('util')

/****************************************************************************
 * UnimplementedEmberType error
 ***************************************************************************/

function UnimplementedEmberTypeError (tag) {
  Error.captureStackTrace(this, this.constructor)
  this.name = this.constructor.name
  var identifier = (tag & 0xC0) >> 6
  var value = (tag & 0x1F).toString()
  var tagStr = tag.toString()
  if (identifier === 0) {
    tagStr = '[UNIVERSAL ' + value + ']'
  } else if (identifier === 1) {
    tagStr = '[APPLICATION ' + value + ']'
  } else if (identifier === 2) {
    tagStr = '[CONTEXT " + value + "]'
  } else {
    tagStr = '[PRIVATE ' + value + ']'
  }
  this.message = 'Unimplemented EmBER type ' + tagStr
}

util.inherits(UnimplementedEmberTypeError, Error)
module.exports.UnimplementedEmberTypeError = UnimplementedEmberTypeError

function ASN1Error (message) {
  Error.captureStackTrace(this, this.constructor)
  this.name = this.constructor.name
  this.message = message
}

util.inherits(ASN1Error, Error)
module.exports.ASN1Error = ASN1Error

function EmberAccessError (message) {
  Error.captureStackTrace(this, this.constructor)
  this.name = this.constructor.name
  if (this.message !== undefined) {
    this.message = message
  } else {
    this.message('Parameter access error')
  }
}

util.inherits(EmberAccessError, Error)
module.exports.EmberAccessError = EmberAccessError

function EmberTimeoutError (message) {
  Error.captureStackTrace(this, this.constructor)
  this.name = this.constructor.name
  this.message = message
}

util.inherits(EmberTimeoutError, Error)
module.exports.EmberTimeoutError = EmberTimeoutError
