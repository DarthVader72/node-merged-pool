'use strict';

var bignum = require('bignum');


var merkleTree = require('./merkleTree.js');
var transactions = require('./transactions.js');
var util = require('./util.js');
var writeUInt64BE = require('writeuint64be');


/**
 * The BlockTemplate class holds a single job.
 * and provides several methods to validate and submit it to the daemon coin
**/
var BlockTemplate = module.exports = function BlockTemplate(jobId, rpcData, poolAddressScript, extraNoncePlaceholder, reward, txMessages, recipients, auxMerkleTree){

    //private members

    const submits = new Set;

    function getMerkleHashes(steps){
        return steps.map(function(step){
            return step.toString('hex');
        });
    }

    function getVoteData(){
        if (!rpcData.masternode_payments) return new Buffer([]);

        return Buffer.concat(
            [util.varIntBuffer(rpcData.votes.length)].concat(
                rpcData.votes.map(function (vt) {
                    return new Buffer(vt, 'hex');
                })
            )
        );
    }

    //public members

    this.rpcData = rpcData;
    this.jobId = jobId;

    var target = rpcData.target || rpcData._target;
    this.target = rpcData.target ?
        bignum(rpcData.target, 16) :
        util.bignumFromBitsHex(rpcData.bits);

    this.difficulty = parseFloat((diff1 / this.target.toNumber()).toFixed(9));





    this.prevHashReversed = util.reverseByteOrder(new Buffer(rpcData.previousblockhash, 'hex')).toString('hex');
    this.transactionData = Buffer.concat(rpcData.transactions.map(function(tx){
        return new Buffer(tx.data, 'hex');
    }));
    this.merkleTree = new merkleTree(util.getHashBuffers(rpcData.transactions.map(function(tx) {
        if (tx.txid !== undefined){
            return tx.txid;
        }
        return tx.hash;
    })));
    this.merkleBranch = getMerkleHashes(this.merkleTree.steps);

    // MERGED MINING - also supply data for coinbase transaction
    this.generationTransaction = transactions.CreateGeneration(
        rpcData,
        poolAddressScript,
        extraNoncePlaceholder,
        reward,
        txMessages,
        recipients,
        auxMerkleTree
    );

    this.serializeCoinbase = function(extraNonce1, extraNonce2){
        return Buffer.concat([
            this.generationTransaction[0],
            Buffer.from(extraNonce1, 'hex'),
            Buffer.from(extraNonce2, 'hex'),
            this.generationTransaction[1]
        ]);
    };


    //https://en.bitcoin.it/wiki/Protocol_specification#Block_Headers
    this.serializeHeader = function(merkleRoot, hashMix, nTime, nonce){
        var header =  new Buffer(120);
        var position = 0;
		header.write(nonce, position, 8, 'hex');
        header.write(hashMix, position += 8, 32, 'hex');
        header.writeUInt32BE(rpcData.height, position += 32, 4);
        header.write(rpcData.bits, position += 4, 4, 'hex');
        header.write(nTime, position += 4, 4, 'hex');
        header.write(merkleRoot, position += 4, 32, 'hex');
        header.write(rpcData.previousblockhash, position += 32, 32, 'hex');
        header.writeUInt32BE(rpcData.version, position + 32);
        var header = util.reverseBuffer(header);
        return header;
    };

    this.serializeBlock = function(header, coinbase){
        return Buffer.concat([
            header,

            util.varIntBuffer(this.rpcData.transactions.length + 1),
            coinbase,
            this.transactionData,

            getVoteData(),

            //POS coins require a zero byte appended to block which the daemon replaces with the signature
            new Buffer(reward === 'POS' ? [0] : [])
        ]);
    };

    this.registerSubmit = function(extraNonce1, extraNonce2, nTime, nonce){
        var submission = extraNonce1 + extraNonce2 + nTime + nonce;
        if (!submits.has(submission)){
            submits.add(submission);
            return true;
        }
        return false;
    };

    this.getJobParams = function(){
        if (!this.jobParams){
            const {rpcData} = this;

            this.jobParams = [
                this.jobId,
                rpcData.previousblockhash.toString('hex'),
                this.generationTransaction[0].toString('hex'),
                this.generationTransaction[1].toString('hex'),
                rpcData.transactions,
                util.packInt32BE(rpcData.version).toString('hex'),
                rpcData.bits,
                util.packUInt32BE(rpcData.curtime).toString('hex'),
                true,
                rpcData.height
            ];
            
            // Warmup
            algos['nrghash'].hash(
                '', rpcData.version, rpcData.previousblockhash,
                rpcData.previousblockhash, rpcData.curtime, rpcData.bits,
                rpcData.height, rpcData.previousblockhash, 1);
        }
        return this.jobParams;
    };
};
