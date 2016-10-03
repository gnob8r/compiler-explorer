#!/usr/bin/env node

// Copyright (c) 2012-2016, Matt Godbolt
// All rights reserved.
// 
// Redistribution and use in source and binary forms, with or without 
// modification, are permitted provided that the following conditions are met:
// 
//     * Redistributions of source code must retain the above copyright notice, 
//       this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright 
//       notice, this list of conditions and the following disclaimer in the 
//       documentation and/or other materials provided with the distribution.
// 
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" 
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE 
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE 
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE 
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR 
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF 
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS 
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN 
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ,
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE 
// POSSIBILITY OF SUCH DAMAGE.

var fs = require('fs'), assert = require('assert');
var asm = require('../lib/asm.js');

function processAsm(filename, filters) {
    var file = fs.readFileSync(filename, 'utf-8');
    return asm.processAsm(file, filters);
}

var cases = fs.readdirSync('./cases')
    .filter(function (x) {
        return x.match(/\.asm$/)
    })
    .map(function (x) {
        return './cases/' + x;
    });

var failures = 0;

function assertEq(a, b, context) {
    if (a != b) {
        console.log("Fail: ", a, " != ", b, context);
        failures++;
    }
}

function bless(filename, output, filters) {
    var result = processAsm(filename, filters);
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
}

function testFilter(filename, suffix, filters) {
    var result = processAsm(filename, filters);
    var expected = filename + suffix;
    var json = false;
    var file;
    try {
        file = fs.readFileSync(expected + '.json', 'utf-8');
        json = true;
    } catch (e) {
    }
    if (!file) {
        try {
            file = fs.readFileSync(expected, 'utf-8');
        } catch (e) {
            console.log("Skipping non-existent test case " + expected);
            return;
        }
    }
    if (json) {
        file = JSON.parse(file);
    } else {
        file = file.split(/\r?\n/);
    }
    assertEq(file.length, result.length, expected);
    var count = Math.min(file.length, result.length);
    for (var i = 0; i < count; ++i) {
        if (json) {
            try {
                assert.deepEqual(file[i], result[i]);
            } catch (e) {
                throw new Error(e + " at " + expected + ":" + (i + 1));
            }
        } else {
            var lineExpected = result[i].text;
            assertEq(file[i], lineExpected, expected + ":" + (i + 1));
        }
    }
}
// bless("cases/cl-regex.asm", "cases/cl-regex.asm.directives.labels.comments.json", {directives: true, labels: true, commentOnly: true});
// bless("cases/cl-regex.asm", "cases/cl-regex.asm.dlcb.json", {directives: true, labels: true, commentOnly: true, binary:true});
// bless("cases/cl-maxarray.asm", "cases/cl-maxarray.asm.dlcb.json", {directives: true, labels: true, commentOnly: true, binary:true});

cases.forEach(function (x) {
    testFilter(x, ".directives", {directives: true})
});
cases.forEach(function (x) {
    testFilter(x, ".directives.labels",
        {directives: true, labels: true})
});
cases.forEach(function (x) {
    testFilter(x, ".directives.labels.comments",
        {directives: true, labels: true, commentOnly: true})
});
cases.forEach(function (x) {
    testFilter(x, ".dlcb",
        {directives: true, labels: true, commentOnly: true, binary: true})
});

if (failures) {
    console.log(failures + " failures");
    process.exit(1);
}
