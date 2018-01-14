// Copyright (c) 2012-2018, Matt Godbolt
//
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
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

define(function (require) {
    "use strict";
    var $ = require('jquery');
    var _ = require('underscore');
    var LruCache = require('lru-cache');
    var options = require('options');
    var Promise = require('es6-promise').Promise;

    function CompilerService() {
        this.cache = new LruCache({
            max: 200 * 1024,
            length: function (n) {
                return JSON.stringify(n).length;
            }
        });
        this.compilersByLang = {};
        _.each(options.compilers, function (compiler) {
            if (!this.compilersByLang[compiler.lang]) this.compilersByLang[compiler.lang] = {};
            this.compilersByLang[compiler.lang][compiler.id] = compiler;
            if (compiler.alias) {
                this.compilersByLang[compiler.lang][compiler.alias] = compiler;
            }
        }, this);
    }

    CompilerService.prototype.getCompilersForLang = function (langId) {
        return this.compilersByLang[langId] || {};
    };

    CompilerService.prototype.findCompiler = function (langId, compilerId) {
        return this.getCompilersForLang(langId)[compilerId];
    };

    CompilerService.prototype.submit = function (request) {
        var jsonRequest = JSON.stringify(request);
        var cachedResult = this.cache.get(jsonRequest);
        if (cachedResult) {
            return Promise.resolve({
                request: request,
                result: cachedResult,
                localCacheHit: true
            });
        }
        return new Promise(_.bind(function (resolve, reject) {
            $.ajax({
                type: 'POST',
                url: 'api/compiler/' + encodeURIComponent(request.compiler) + '/compile',
                dataType: 'json',
                contentType: 'application/json',
                data: jsonRequest,
                success: _.bind(function (result) {
                    if (result && result.okToCache) {
                        this.cache.set(jsonRequest, result);
                    }
                    resolve({
                        request: request,
                        result: result,
                        localCacheHit: false
                    });
                }, this),
                error: function (xhr, textStatus, errorThrown) {
                    var error = errorThrown;
                    if (!error) {
                        switch (textStatus) {
                            case "timeout":
                                error = "Request timed out";
                                break;
                            case "abort":
                                error = "Request was aborted";
                                break;
                            default:
                                error = "Error sending request";
                                break;
                        }
                    }
                    reject({
                        request: request,
                        error: error
                    });
                }
            });
        }, this));
    };

    CompilerService.prototype.expand = function (source) {
        var includeFind = /^\s*#include\s*["<](https?:\/\/[^>"]+)[>"]/;
        var lines = source.split("\n");
        var promises = [];
        _.each(lines, function (line, lineNumZeroBased) {
            var match = line.match(includeFind);
            if (match) {
                promises.push(new Promise(function (resolve, reject) {
                    var req = $.get(match[1], function (data) {
                        data = '#line 1 "' + match[1] + '"\n' + data + '\n\n#line ' +
                            (lineNumZeroBased + 1) + ' "<stdin>"\n';

                        lines[lineNumZeroBased] = data;
                        resolve();
                    });
                    req.fail(function () {
                        resolve();
                    });
                }));
            }
        });
        return Promise.all(promises).then(function () {
            return lines.join("\n");
        });
    };

    return CompilerService;
});
