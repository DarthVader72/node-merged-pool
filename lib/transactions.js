'use strict';

var util = require('./util.js');


/*
function Transaction(params){

    var version = params.version || 1,
        inputs = params.inputs || [],
        outputs = params.outputs || [],
        lockTime = params.lockTime || 0;


    this.toBuffer = function(){
        return Buffer.concat([
            binpack.packUInt32(version, 'little'),
            util.varIntBuffer(inputs.length),
            Buffer.concat(inputs.map(function(i){ return i.toBuffer() })),
            util.varIntBuffer(outputs.length),
            Buffer.concat(outputs.map(function(o){ return o.toBuffer() })),
            binpack.packUInt32(lockTime, 'little')
        ]);
    };

    this.inputs = inputs;
    this.outputs = outputs;

}

function TransactionInput(params){

    var prevOutHash = params.prevOutHash || 0,
        prevOutIndex = params.prevOutIndex,
        sigScript = params.sigScript,
        sequence = params.sequence || 0;


    this.toBuffer = function(){
        sigScriptBuffer = sigScript.toBuffer();
        console.log('scriptSig length ' + sigScriptBuffer.length);
        return Buffer.concat([
            util.uint256BufferFromHash(prevOutHash),
            binpack.packUInt32(prevOutIndex, 'little'),
            util.varIntBuffer(sigScriptBuffer.length),
            sigScriptBuffer,
            binpack.packUInt32(sequence)
        ]);
    };
}

function TransactionOutput(params){

    var value = params.value,
        pkScriptBuffer = params.pkScriptBuffer;

    this.toBuffer = function(){
        return Buffer.concat([
            binpack.packInt64(value, 'little'),
            util.varIntBuffer(pkScriptBuffer.length),
            pkScriptBuffer
        ]);
    };
}

function ScriptSig(params){

    var height = params.height,
        flags = params.flags,
        extraNoncePlaceholder = params.extraNoncePlaceholder;

    this.toBuffer = function(){

        return Buffer.concat([
            util.serializeNumber(height),
            new Buffer(flags, 'hex'),
            util.serializeNumber(Date.now() / 1000 | 0),
            new Buffer([extraNoncePlaceholder.length]),
            extraNoncePlaceholder,
            util.serializeString('/nodeStratum/')
        ]);
    }
};


var Generation = exports.Generation = function Generation(rpcData, publicKey, extraNoncePlaceholder){

    var tx = new Transaction({
        inputs: [new TransactionInput({
            prevOutIndex : Math.pow(2, 32) - 1,
            sigScript    : new ScriptSig({
                height                : rpcData.height,
                flags                 : rpcData.coinbaseaux.flags,
                extraNoncePlaceholder : extraNoncePlaceholder
            })
        })],
        outputs: [new TransactionOutput({
            value          : rpcData.coinbasevalue,
            pkScriptBuffer : publicKey
        })]
    });

    var txBuffer = tx.toBuffer();
    var epIndex  = buffertools.indexOf(txBuffer, extraNoncePlaceholder);
    var p1       = txBuffer.slice(0, epIndex);
    var p2       = txBuffer.slice(epIndex + extraNoncePlaceholder.length);

    this.transaction = tx;
    this.coinbase = [p1, p2];

};
*/


/*
     ^^^^ The above code was a bit slow. The below code is uglier but optimized.
 */



/*
This function creates the generation transaction that accepts the reward for
successfully mining a new block.
For some (probably outdated and incorrect) documentation about whats kinda going on here,
see: https://en.bitcoin.it/wiki/Protocol_specification#tx
 */

var generateOutputTransactions = function(poolRecipient, recipients, rpcData){

    let rewardToPool = rpcData.coinbasevalue;

    var txOutputBuffers = [];


    /* Dash 12.1 */
    if (rpcData.masternode_payments_started && rpcData.masternode && rpcData.masternode.script) {
        const payeeReward = rpcData.masternode.amount;
        rewardToPool -= payeeReward;
        const payeeScript = Buffer.from(rpcData.masternode.script, 'hex');
        txOutputBuffers.push(Buffer.concat([
                    util.packInt64LE(payeeReward),
                    util.varIntBuffer(payeeScript.length),
                    payeeScript
        ]));
    }
    
    let is_superblock = rpcData.superblocks_enabled;

    if (is_superblock) {
        if (rpcData.superblock.length > 0) {
            for(let sb of rpcData.superblock){
                const payeeReward = sb.amount;
                rewardToPool -= payeeReward;

                var payeeScript = Buffer.from(sb.script, 'hex');
                txOutputBuffers.push(Buffer.concat([
                            util.packInt64LE(payeeReward),
                            util.varIntBuffer(payeeScript.length),
                            payeeScript
                ]));
            }
        } else {
            is_superblock = false;
        }
    }

    if (!is_superblock) {
        const payeeReward = rpcData.backbone.amount;

        rewardToPool -= payeeReward;

        var payeeScript = Buffer.from(rpcData.backbone.script, "hex");
        txOutputBuffers.push(Buffer.concat([
            util.packInt64LE(payeeReward),
            util.varIntBuffer(payeeScript.length),
            payeeScript
        ]));
    }

    const reward = rewardToPool;

    for (let r of recipients) {
        const recipientReward = Math.floor(r.percent * reward);
        rewardToPool -= recipientReward;

        txOutputBuffers.push(Buffer.concat([
            util.packInt64LE(recipientReward),
            util.varIntBuffer(r.script.length),
            r.script
        ]));
    }

    txOutputBuffers.unshift(Buffer.concat([
        util.packInt64LE(rewardToPool),
        util.varIntBuffer(poolRecipient.length),
        poolRecipient
    ]));

    if (rpcData.default_witness_commitment !== undefined){
        witness_commitment = new Buffer(rpcData.default_witness_commitment, 'hex');
        txOutputBuffers.unshift(Buffer.concat([
            util.packInt64LE(0),
            util.varIntBuffer(witness_commitment.length),
            witness_commitment
        ]));
    }

    return Buffer.concat([
        util.varIntBuffer(txOutputBuffers.length),
        Buffer.concat(txOutputBuffers)
    ]);

};


exports.CreateGeneration = function(rpcData, publicKey, extraNoncePlaceholder, reward, txMessages, recipients, auxMerkleTree){
    var txInputsCount = 1;
    var txOutputsCount = 1;
    var txVersion = 1;
    var txLockTime = 0;

    var txInPrevOutHash = '00';
    var txInSequence = 0;


    var scriptSigPart1 = Buffer.concat([
        util.serializeNumber(rpcData.height),
        new Buffer([extraNoncePlaceholder.length]),
    ]);

    var p1 = Buffer.concat([
        util.packUInt32LE(txVersion),

        //transaction input
        util.varIntBuffer(txInputsCount),
        util.uint256BufferFromHash(txInPrevOutHash),
        util.packUInt32LE(0xFFFFFFFF),
        util.varIntBuffer(scriptSigPart1.length + extraNoncePlaceholder.length),
        scriptSigPart1
    ]);


    /*
    The generation transaction must be split at the extranonce (which located in the transaction input
    scriptSig). Miners send us unique extranonces that we use to join the two parts in attempt to create
    a valid share and/or block.
     */

    var outputTransactions = generateOutputTransactions(publicKey, recipients, rpcData);

    var p2 = Buffer.concat([
        util.packUInt32LE(txInSequence),
        //end transaction input

        //transaction output
        outputTransactions,
        //end transaction ouput

        util.packUInt32LE(txLockTime)
    ]);

    return [p1, p2];

};
