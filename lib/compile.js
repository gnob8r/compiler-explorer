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
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) 
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE 
// POSSIBILITY OF SUCH DAMAGE.

var child_process = require('child_process'),
    temp = require('temp'),
    path = require('path'),
    httpProxy = require('http-proxy'),
    fs = require('fs-extra'),
    Promise = require('promise'), // jshint ignore:line
    asm = require('./asm'),
    utils = require('./utils'),
    quote = require('shell-quote'),
    _ = require('underscore-node'),
    logger = require('./logger').logger,
    CompilationEnvironment = require('./compilation-env').CompilationEnvironment;

temp.track();

function periodicCleanup() {
    temp.cleanup(function (err, stats) {
        if (err) logger.error("Error cleaning directories: ", err);
        if (stats) logger.debug("Directory cleanup stats:", stats);
    });
}
var gccProps = null;
var compilerProps = null;
var stubRe = null;
var stubText = null;

function identity(x) {
    return x;
}

function initialise(gccProps_, compilerProps_) {
    gccProps = gccProps_;
    compilerProps = compilerProps_;
    var tempDirCleanupSecs = gccProps("tempDirCleanupSecs", 600);
    logger.info("Cleaning temp dirs every " + tempDirCleanupSecs + " secs");
    setInterval(periodicCleanup, tempDirCleanupSecs * 1000);
    asm.initialise(compilerProps);
    stubRe = compilerProps("stubRe");
    stubText = compilerProps("stubText");
}

function Compile(compiler, env) {
    this.compiler = compiler;
    this.env = env;
}

Compile.prototype.newTempDir = function () {
    return new Promise(function (resolve, reject) {
        temp.mkdir('gcc-explorer-compiler', function (err, dirPath) {
            if (err)
                reject("Unable to open temp file: " + err);
            else
                resolve(dirPath);
        });
    });
};

Compile.prototype.writeFile = Promise.denodeify(fs.writeFile);
Compile.prototype.readFile = Promise.denodeify(fs.readFile);
Compile.prototype.stat = Promise.denodeify(fs.stat);

Compile.prototype.convert6g = function (code) {
    var re = /^[0-9]+\s*\(([^:]+):([0-9]+)\)\s*([A-Z]+)(.*)/;
    var prevLine = null;
    var file = null;
    return code.map(function (obj) {
        var line = obj.line;
        var match = line.match(re);
        if (match) {
            var res = "";
            if (file === null) {
                res += "\t.file 1 \"" + match[1] + "\"\n";
                file = match[1];
            }
            if (prevLine != match[2]) {
                res += "\t.loc 1 " + match[2] + "\n";
                prevLine = match[2];
            }
            return res + "\t" + match[3].toLowerCase() + match[4];
        } else
            return null;
    }).filter(identity).join("\n");
};

Compile.prototype.getRemote = function () {
    if (this.compiler.exe === null && this.compiler.remote)
        return this.compiler.remote;
    return false;
};

Compile.prototype.runCompiler = function (compiler, options, inputFilename) {
    var okToCache = true;
    var env = this.env.getEnv(this.compiler.needsMulti);
    var child = child_process.spawn(
        compiler,
        options,
        {detached: process.platform == 'linux', env: env}
    );
    var stdout = "";
    var stderr = "";
    var timeout = setTimeout(function () {
        okToCache = false;
        child.kill();
        stderr += "\nKilled - processing time exceeded";
    }, gccProps("compileTimeoutMs", 100));
    var truncated = false;
    var maxOutput = gccProps("max-error-output", 5000);
    child.stdout.on('data', function (data) {
        if (truncated) return;
        if (stdout.length > maxOutput) {
            stdout += "\n[Truncated]";
            truncated = true;
            child.kill();
            return;
        }
        stdout += data;
    });
    child.stderr.on('data', function (data) {
        if (truncated) return;
        if (stderr.length > maxOutput) {
            stderr += "\n[Truncated]";
            truncated = true;
            child.kill();
            return;
        }
        stderr += data;
    });
    return new Promise(function (resolve, reject) {
        child.on('error', function (e) {
            reject(e);
        });
        child.on('exit', function (code) {
            clearTimeout(timeout);
            // Why is this apparently needed in some cases (e.g. when I used to use this to do getMultiarch)?
            // Without it, I apparently get stdout/stderr callbacks *after* the exit...
            setTimeout(function () {
                resolve({
                    code: code,
                    stdout: utils.parseOutput(stdout, inputFilename),
                    stderr: utils.parseOutput(stderr, inputFilename),
                    okToCache: okToCache
                });
            }, 0);
        });
        child.stdin.end();
    });
};

Compile.prototype.objdump = function (outputFilename, result, maxSize, intelAsm) {
    var objDumpCommand = 'objdump -d -C "' + outputFilename + '" -l --insn-width=16';
    if (intelAsm) objDumpCommand += " -M intel";
    return new Promise(function (resolve) {
        child_process.exec(objDumpCommand,
            {maxBuffer: maxSize},
            function (err, data) {
                if (err)
                    data = '<No output: ' + err + '>';
                result.asm = data;
                resolve(result);
            });
    });
};

Compile.prototype.compile = function (source, options, filters) {
    var self = this;
    var optionsError = self.checkOptions(options);
    if (optionsError) return Promise.reject(optionsError);
    var sourceError = self.checkSource(source);
    if (sourceError) return Promise.reject(sourceError);

    // Don't run binary for unsupported compilers, even if we're asked.
    if (filters.binary && !self.compiler.supportsBinary) {
        delete filters.binary;
    }

    var key = JSON.stringify({compiler: this.compiler, source: source, options: options, filters: filters});
    var cached = this.env.cacheGet(key);
    if (cached) {
        return Promise.resolve(cached);
    }

    if (filters.binary && !source.match(stubRe)) {
        source += "\n" + stubText + "\n";
    }

    var tempFileAndDirPromise = Promise.resolve().then(function () {
        return self.newTempDir().then(function (dirPath) {
            var inputFilename = path.join(dirPath, compilerProps("compileFilename"));
            return self.writeFile(inputFilename, source).then(function () {
                return {inputFilename: inputFilename, dirPath: dirPath};
            });
        });
    });

    function filename(fn) {
        if (self.compiler.needsWine) {
            return 'Z:' + fn;
        } else {
            return fn;
        }
    }

    var compileToAsmPromise = tempFileAndDirPromise.then(function (info) {
        var inputFilename = info.inputFilename;
        var dirPath = info.dirPath;
        var postProcess = self.compiler.postProcess.filter(function (x) {
            return x;
        });
        var outputFilename = path.join(dirPath, 'output.s'); // NB keep lower case as ldc compiler `tolower`s the output name
        if (self.compiler.options) {
            options = options.concat(self.compiler.options.split(" "));
        }
        if (self.compiler.intelAsm && filters.intel && !filters.binary) {
            options = options.concat(self.compiler.intelAsm.split(" "));
        }
        var compileToAsm;
        var asmFlag = self.compiler.asmFlag ? self.compiler.asmFlag : "-S";
        var outputFlag = self.compiler.outputFlag ? self.compiler.outputFlag : "-o";
        if (!filters.binary) {
            compileToAsm = compilerProps("compileToAsm", asmFlag).split(" ");
        } else {
            compileToAsm = compilerProps("compileToBinary", "").split(" ");
        }
        if (self.compiler.isCl) {
            options = options.concat(['/FAsc', '/c', '/Fa' + filename(outputFilename), '/Fo' + filename(outputFilename) + ".obj"]);
        } else {
            options = ['-g', outputFlag, filename(outputFilename)].concat(options);
        }
        options = options.concat(compileToAsm).concat([filename(inputFilename)]);

        var compilerExe = self.compiler.exe;
        if (self.compiler.needsWine) {
            options = [compilerExe].concat(options);
            compilerExe = gccProps("wine");
        }
        var compilerWrapper = compilerProps("compiler-wrapper");
        if (compilerWrapper) {
            options = [compilerExe].concat(options);
            compilerExe = compilerWrapper;
        }
        var maxSize = gccProps("max-asm-size", 8 * 1024 * 1024);
        options = options.filter(identity);
        return self.runCompiler(compilerExe, options, filename(inputFilename))
            .then(function (result) {
                result.dirPath = dirPath;
                if (result.code !== 0) {
                    result.asm = "<Compilation failed>";
                    return result;
                }
                if (self.compiler.is6g) {
                    result.asm = self.convert6g(result.stdout);
                    result.stdout = [];
                    return Promise.resolve(result);
                }
                if (filters.binary && !self.compiler.isCl) {
                    return self.objdump(outputFilename, result, maxSize, filters.intel);
                }
                return self.stat(outputFilename).then(function (stat) {
                    if (stat.size >= maxSize) {
                        result.asm = "<No output: generated assembly was too large (" + stat.size + " > " + maxSize + " bytes)>";
                        return result;
                    }
                    if (postProcess.length) {
                        return new Promise(function (resolve) {
                            var postCommand = 'cat "' + outputFilename + '" | ' + postProcess.join(" | ");
                            child_process.exec(postCommand,
                                {maxBuffer: maxSize},
                                function (err, data) {
                                    if (err)
                                        data = '<No output: ' + err + '>';
                                    result.asm = data;
                                    resolve(result);
                                });
                        });
                    } else {
                        return self.readFile(outputFilename).then(function (contents) {
                            result.asm = contents.toString();
                            return Promise.resolve(result);
                        });
                    }
                }, function () {
                    result.asm = "<No output file>";
                    return result;
                });
            });
    });

    return self.env.enqueue(function () {
        return compileToAsmPromise.then(function (result) {
            if (result.dirPath) {
                fs.remove(result.dirPath);
                result.dirPath = undefined;
            }
            if (result.okToCache) {
                result.asm = asm.processAsm(result.asm, filters);
                self.env.cachePut(key, result);
            } else {
                result.asm = {text: result.asm};
            }
            return result;
        });
    });
};

Compile.prototype.checkOptions = function (options) {
    var error = this.env.findBadOptions(options);
    if (error.length > 0) return "Bad options: " + error.join(", ");
    return null;
};

Compile.prototype.checkSource = function (source) {
    var re = /^\s*#\s*i(nclude|mport)(_next)?\s+["<"](\/|.*\.\.)/;
    var failed = [];
    utils.splitLines(source).forEach(function (line, index) {
        if (line.match(re)) {
            failed.push("<stdin>:" + (index + 1) + ":1: no absolute or relative includes please");
        }
    });
    if (failed.length > 0) return failed.join("\n");
    return null;
};

function CompileHandler() {
    this.compilersById = {};
    this.compilerEnv = new CompilationEnvironment(gccProps);

    this.setCompilers = function (compilers) {
        this.compilersById = {};
        _.each(compilers, function (compiler) {
            this.compilersById[compiler.id] = new Compile(compiler, this.compilerEnv);
        }, this);
    };
    var proxy = httpProxy.createProxyServer({});

    this.handler = _.bind(function compile(req, res, next) {
        var compiler = this.compilersById[req.body.compiler];
        if (!compiler) return next();

        var remote = compiler.getRemote();
        if (remote) {
            proxy.web(req, res, {target: remote}, function (e) {
                logger.error("Proxy error: ", e);
                next(e);
            });
            return;
        }
        var source = req.body.source;
        var options = req.body.options || '';
        if (source === undefined) {
            return next(new Error("Bad request"));
        }
        options = quote.parse(options).filter(identity);
        var filters = req.body.filters;
        compiler.compile(source, options, filters).then(
            function (result) {
                res.set('Content-Type', 'application/json');
                res.end(JSON.stringify(result));
            },
            function (error) {
                logger.error("Error: " + error);
                if (typeof(error) !== "string") {
                    error = "Internal GCC explorer error: " + error.toString();
                }
                res.end(JSON.stringify({code: -1, stderr: [{text: error}]}));
            }
        );
    }, this);
}

module.exports = {
    CompileHandler: CompileHandler,
    initialise: initialise
};
