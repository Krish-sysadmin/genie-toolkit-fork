// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const { DatasetParser } = require('../lib/dataset-parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ParserClient = require('./lib/parserclient');
const { SentenceEvaluatorStream, CollectSentenceStatistics } = require('../lib/evaluators');

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('evaluate-server', {
            addHelp: true,
            description: "Evaluate a trained model on a Genie-generated dataset, by contacting a running Genie server."
        });
        parser.addArgument('--url', {
            required: false,
            help: "URL of the server to evaluate. Use a file:// URL pointing to a model directory to evaluate using a local instance of decanlp",
            defaultValue: 'http://127.0.0.1:8400',
        });
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: true,
            help: "The dataset is already tokenized (this is the default)."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in TSV format); use - for standard input'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
        });
        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
        parser.addArgument('--csv', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Output a single CSV line',
        });
    },

    async execute(args) {
        const tpClient = new Tp.FileClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        const parser = ParserClient.get(args.url, args.locale);
        await parser.start();

        const output = readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true, parseMultiplePrograms: true }))
            .pipe(new SentenceEvaluatorStream(parser, schemas, args.tokenized, args.debug))
            .pipe(new CollectSentenceStatistics());

        const result = await output.read();

        if (args.csv) {
            let buffer = String(result.total);
            for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax']) {
                result[key].length = parseInt(process.env.CSV_LENGTH || 1);
                if (buffer)
                    buffer += ',';
                buffer += String(result[key]);
            }
            console.log(buffer);
        } else {
            for (let key in result) {
                if (Array.isArray(result[key]))
                    console.log(`${key} = [${result[key].join(', ')}]`);
                else
                    console.log(`${key} = ${result[key]}`);
            }
        }

        await parser.stop();
    }
};
