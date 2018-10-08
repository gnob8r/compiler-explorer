// Copyright (c) 2018, Compiler Explorer Authors
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

'use strict';

var options = require('options'),
    _ = require('underscore'),
    $ = require('jquery');

function LibsWidget(langId, dropdownButton, state) {
    this.dropdownButton = dropdownButton;
    this.state = state;
    this.currentLangId = langId;
    this.initButtons();

    this.availableLibs = {};
    this.updateAvailableLibs(langId);
    _.each(state.libs, _.bind(function (lib) {
        this.markLibrary(lib.name, lib.ver, true);
    }, this));
}

LibsWidget.prototype.initButtons = function () {
    this.noLibsPanel = $('#libs-dropdown .no-libs');
    this.libsEntry = $('#libs-entry .card');
};

LibsWidget.prototype.initLangDefaultLibs = function () {
    var defaultLibs = options.defaultLibs[this.currentLangId];
    if (!defaultLibs) return;
    _.each(defaultLibs.split(':'), _.bind(function (libPair) {
        var pairSplits = libPair.split('.');
        if (pairSplits.length === 2) {
            var lib = pairSplits[0];
            var ver = pairSplits[1];
            this.markLibrary(lib, ver, true);
        }
    }, this));
};

LibsWidget.prototype.updateAvailableLibs = function () {
    if (!this.availableLibs[this.currentLangId]) {
        this.availableLibs[this.currentLangId] = $.extend(true, {}, options.libs[this.currentLangId]);
    }
    this.initLangDefaultLibs();
    this.updateLibsDropdown();
};

LibsWidget.prototype.setNewLangId = function (langId) {
    this.currentLangId = langId;
};

LibsWidget.prototype.updateLibsDropdown = function () {
    this.dropdownButton.popover({
        container: 'body',
        content: _.bind(function () {
            var libsCount = _.keys(this.availableLibs[this.currentLangId]).length;
            if (libsCount === 0) return this.noLibsPanel;
            var libsPanel = $('<div class="card-columns"></div>');
            _.each(this.availableLibs[this.currentLangId], _.bind(function (libEntry) {
                var newLibCard = this.libsEntry.clone();
                newLibCard.find('.card-header')
                    .text(libEntry.name)
                    .prop('title', libEntry.description || '');
                _.each(libEntry.versions, function (version) {
                    newLibCard.find('.card-body')
                        .append($('<span></span>').text(version.version));
                });
                newLibCard.find('.card-footer').append($('<a></a>')
                    .prop('href', libEntry.url)
                    .text(libEntry.url)
                );
                libsPanel.append(newLibCard);
            }, this));
            return libsPanel;
        }, this),
        html: true,
        placement: 'bottom',
        trigger: 'manual'
    }).click(_.bind(function () {
        this.dropdownButton.popover('show');
    }, this)).on('shown.bs.popover', function () {
        $($(this).data('bs.popover').tip).css({
            'max-width': '600px',
            'max-height': '250px'
        });
    });
};

LibsWidget.prototype.markLibrary = function (name, version, used) {
    if (this.availableLibs[this.currentLangId] &&
        this.availableLibs[this.currentLangId][name] &&
        this.availableLibs[this.currentLangId][name].versions[version]) {

        this.availableLibs[this.currentLangId][name].versions[version].used = used;
    }
};

LibsWidget.prototype.get = function () {
    return _.map(this.getLibsInUse(), function (item) {
        return {name: item.name, ver: item.version};
    });
};

LibsWidget.prototype.getLibsInUse = function () {
    var libs = [];
    _.each(this.availableLibs[this.currentLangId], function (library) {
        _.each(library.versions, function (version, ver) {
            if (library.versions[ver].used) {
                libs.push(library.versions[ver]);
            }
        });
    });
    return libs;
};

module.exports = {
    Widget: LibsWidget
};
