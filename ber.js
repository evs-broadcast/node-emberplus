/****************************************************************************
 * This file extends node-asn1's functionality in two main ways.
 *
 * The first is through getSequence on the reader.  This consumes the next
 * item entirely, returning a new Reader with its contents.  This makes it
 * much easier to read containers with an unknown count of items, without
 * the application having to keep track of how much it's consumed and how
 * long the original container was.
 *
 * The second is through the addition of readReal/writeReal methods.  These
 * are a little bit scary to do in JavaScript, which doesn't have real
 * integer types.  Unfortunately, most of the implementations of BER out
 * there are for doing PKI stuff, so I've been able to find few real-world
 * examples of real value encoding/decoding for BER.  These routines are
 * inspired heavily by libember, which works with the bits of an IEEE
 * double.  Note that this is *not* a complete implementation of X.690,
 * but only the subset required by EmBER (only base 2 for the exponent, and
 * only binary encoding).
 *
 * There are a few other methods thrown in to simplify many of the
 * structures encountered in EmBER.
 ***************************************************************************/

const BER = require('asn1').Ber;
const errors = require('./errors.js');
const util = require('util');
const Long = require('long');

var APPLICATION = function(x) { return x | 0x60; };
var CONTEXT = function(x) { return x | 0xa0; };
var UNIVERSAL = function(x) { return x; };


const EMBER_BOOLEAN             = 1;
const EMBER_INTEGER             = 2;
const EMBER_BITSTRING           = 3;
const EMBER_OCTETSTRING         = 4;
const EMBER_NULL                = 5;
const EMBER_OBJECTIDENTIFIER    = 6;
const EMBER_OBJECTDESCRIPTOR    = 7;
const EMBER_EXTERNAL            = 8;
const EMBER_REAL                = 9;
const EMBER_ENUMERATED          = 10;
const EMBER_EMBEDDED            = 11;
const EMBER_STRING              = 12;
const EMBER_RELATIVE_OID        = 13;

const EMBER_SEQUENCE            = 0x20 | 16;
const EMBER_SET                 = 0x20 | 17;

module.exports.APPLICATION = APPLICATION;
module.exports.CONTEXT = CONTEXT;
module.exports.UNIVERSAL = UNIVERSAL;
module.exports.EMBER_SET = EMBER_SET;
module.exports.EMBER_SEQUENCE = EMBER_SEQUENCE;
module.exports.EMBER_BOOLEAN = EMBER_BOOLEAN;
module.exports.EMBER_INTEGER = EMBER_INTEGER;
module.exports.EMBER_BITSTRING = EMBER_BITSTRING;
module.exports.EMBER_OCTETSTRING = EMBER_OCTETSTRING;
module.exports.EMBER_NULL = EMBER_NULL;
module.exports.EMBER_OBJECTIDENTIFIER = EMBER_OBJECTIDENTIFIER;
module.exports.EMBER_OBJECTDESCRIPTOR = EMBER_OBJECTDESCRIPTOR;
module.exports.EMBER_EXTERNAL = EMBER_EXTERNAL;
module.exports.EMBER_REAL = EMBER_REAL;
module.exports.EMBER_ENUMERATED = EMBER_ENUMERATED;
module.exports.EMBER_EMBEDDED = EMBER_EMBEDDED;
module.exports.EMBER_STRING = EMBER_STRING;
module.exports.EMBER_RELATIVE_OID = EMBER_RELATIVE_OID;

function ExtendedReader(data) {
    ExtendedReader.super_.call(this, data);
}

util.inherits(ExtendedReader, BER.Reader);
module.exports.Reader = ExtendedReader;


readBlock = function(ber) {

}


ExtendedReader.prototype.getSequence = function(tag) {
    var buf = this.readString(tag, true);
    return new ExtendedReader(buf);
}

ExtendedReader.prototype.readValue = function() {
    var tag = this.peek();

    if(tag == EMBER_STRING) {
        return this.readString(EMBER_STRING);
    } else if(tag == EMBER_INTEGER) {
        return this.readInt();
    } else if(tag == EMBER_REAL) {
        return this.readReal();
    } else if(tag == EMBER_BOOLEAN) {
        return this.readBoolean();
    } else if(tag == EMBER_OCTETSTRING) {
        return this.readString(UNIVERSAL(4), true);
    } else if (tag === EMBER_RELATIVE_OID) {
        return this.readOID(EMBER_RELATIVE_OID);
    } else if (tag === EMBER_NULL)
        return null;
    else {
        throw new errors.UnimplementedEmberTypeError(tag);
    }
}


ExtendedReader.prototype.readReal = function(tag) {
    if(tag !== undefined) {
        tag = UNIVERSAL(9);
    }

    var b = this.peek();
    if(b === null) {
        return null;
    }

    var buf = this.readString(b, true);

    if(buf.length == 0) {
        return 0;
    }

    //console.log(buf);

    var preamble = buf.readUInt8(0);
    var o = 1;

    if(buf.length == 1 && preamble == 0x40) {
        return Infinity;
    } else if(buf.length == 1 && preamble == 0x41) {
        return -Infinity;
    } else if(buf.length == 1 && preamble == 0x42) {
        return NaN;
    }

    var sign = (preamble & 0x40)? -1 : 1;
    var exponentLength = 1 + (preamble & 3);
    var significandShift = (preamble >> 2) & 3;

    var exponent = 0;

    if(buf.readUInt8(o) & 0x80) {
        exponent = -1;
    }

    if(buf.length - o < exponentLength) {
        throw new errors.ASN1Error('Invalid ASN.1; not enough length to contain exponent');
    }

    for(var i=0; i<exponentLength; i++) {
        exponent = (exponent << 8) | buf.readUInt8(o++);
    }

    var significand = new Long(0, 0, true);
    while(o < buf.length) {
        significand = significand.shl(8).or(buf.readUInt8(o++));
    }

    significand = significand.shl(significandShift);

    var mask = Long.fromBits(0x00000000, 0x7FFFF000, true)
    while(significand.and(mask).eq(0)) {
        significand = significand.shl(8);
    }

    mask = Long.fromBits(0x00000000, 0x7FF00000, true)
    while(significand.and(mask).eq(0)) {
        significand = significand.shl(1);
    }

    significand = significand.and(Long.fromBits(0xFFFFFFFF, 0x000FFFFF, true));

    exponent = Long.fromNumber(exponent);
    var bits = exponent.add(1023).shl(52).or(significand);
    if(sign < 0) {
        bits = bits.or(Long.fromBits(0x00000000, 0x80000000, true));
    }

    var fbuf = Buffer.alloc(8);
    fbuf.writeUInt32LE(bits.getLowBitsUnsigned(), 0);
    fbuf.writeUInt32LE(bits.getHighBitsUnsigned(), 4);

    return fbuf.readDoubleLE(0);
}

function ExtendedWriter(options) {
    ExtendedWriter.super_.call(this, options);
}

ExtendedWriter._shorten = function(value) {
    var size = 4;
    while((((value & 0xff800000) === 0) || ((value & 0xff800000) === 0xff800000 >> 0)) &&
             (size > 1)) {
        size--;
        value <<= 8;
    }

    return {size, value}
}

ExtendedWriter._shortenLong = function(value) {
    var mask = Long.fromBits(0x00000000, 0xff800000, true);
    value = value.toUnsigned();

    var size = 8;
    while(value.and(mask).eq(0) || (value.and(mask).eq(mask) && (size > 1))) {
        size--;
        value = value.shl(8);
    }

    return {size, value};
}

ExtendedWriter.prototype.writeReal = function(value, tag) {
    if(tag === undefined) {
        tag = UNIVERSAL(9);
    }

    this.writeByte(tag);
    if(value == 0) {
        this.writeLength(0);
        return;
    } else if(value == Infinity) {
        this.writeLength(1);
        this.writeByte(0x40);
        return;
    } else if(value == -Infinity) {
        this.writeLength(1);
        this.writeByte(0x41);
        return;
    } else if(isNaN(value)) {
        this.writeLength(1);
        this.writeByte(0x42);
        return;
    }

    var fbuf = Buffer.alloc(8);
    fbuf.writeDoubleLE(value, 0);


    var bits = Long.fromBits(fbuf.readUInt32LE(0), fbuf.readUInt32LE(4), true);
    //console.log(bits);
    var significand = bits.and(Long.fromBits(0xFFFFFFFF, 0x000FFFFF, true)).or(
        Long.fromBits(0x00000000, 0x00100000, true));
    var exponent = bits.and(Long.fromBits(0x00000000, 0x7FF00000, true)).shru(52)
        .sub(1023).toSigned();
    while(significand.and(0xFF) == 0)
        significand = significand.shru(8);
    while(significand.and(0x01) == 0)
        significand = significand.shru(1);

    //console.log(significand, exponent);
    exponent = exponent.toNumber();
    //console.log(significand.toNumber(), exponent);

    exponent = ExtendedWriter._shorten(exponent);
    significand = ExtendedWriter._shortenLong(significand);

    this.writeLength(1 + exponent.size + significand.size);
    var preamble = 0x80;
    if(value < 0) preamble |= 0x40;
    this.writeByte(preamble);

    for(var i=0; i<exponent.size; i++) {
        this.writeByte((exponent.value & 0xFF000000) >> 24);
        exponent.value <<= 8;
    }

    var mask = Long.fromBits(0x00000000, 0xFF000000, true);
    for(var i=0; i<significand.size; i++) {
        var b = significand.value.and(mask);
        //console.log("masked:", b);
        this.writeByte(significand.value.and(mask).shru(56).toNumber());
        significand.value = significand.value.shl(8);
    }
}

ExtendedWriter.prototype.writeValue = function(value, tag) {
    // accepts Ember.ParameterContents for enforcing real types
    if (value === null) {
        tag = EMBER_NULL;
        this.writeNull();
        return
    }

    if(typeof value === 'object' && value.type && value.type.key && value.type.key.length && typeof value.type.key === 'string') {
         if(value.type.key === 'real') {
            this.writeReal(value.value, tag);
            return
         }
     }

     if(Number.isInteger(value)) {
        if (tag === undefined) {
            tag = EMBER_INTEGER;
        }
        this.writeInt(value, tag);
    } else if(typeof value == 'boolean') {
        if (tag === undefined) {
            tag = EMBER_BOOLEAN;
        }
        this.writeBoolean(value, tag);
    } else if(typeof value == 'number') {
        if (tag === undefined) {
            tag = EMBER_REAL;
        }
        this.writeReal(value, tag);
    } else if(Buffer.isBuffer(value)) {
        this.writeBuffer(value, tag);
    } else {
        if (tag === undefined) {
            tag = EMBER_STRING;
        }
        this.writeString(value.toString(), tag);
    }
}

ExtendedWriter.prototype.writeIfDefined = function(property, writer, outer, inner) {
    if(property !== undefined) {
        this.startSequence(CONTEXT(outer));
        writer.call(this, property, inner);
        this.endSequence();
    }
}

ExtendedWriter.prototype.writeIfDefinedEnum = function(property, type, writer, outer, inner) {
    if(property !== undefined) {
        this.startSequence(CONTEXT(outer));
        if(property.value !== undefined) {
            writer.call(this, property.value, inner);
        } else {
            writer.call(this, type.get(property), inner);
        }
        this.endSequence();
    }
}

util.inherits(ExtendedWriter, BER.Writer);
module.exports.Writer = ExtendedWriter;
