// Copyright (c) 2021, Compiler Explorer Authors
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

import $ from 'jquery';
import Sentry from '@sentry/browser';
import GoldenLayout from 'golden-layout';
import _ from 'underscore'

import ClickEvent = JQuery.ClickEvent;
import TriggeredEvent = JQuery.TriggeredEvent;

const ga = require('./analytics');
const options = require('./options');
const url = require('./url');
const cloneDeep = require('lodash.clonedeep');

enum LinkType {
    Short,
    Full,
    Embed
}

const shareServices = {
    twitter: {
        embedValid: false,
        logoClass: 'fab fa-twitter',
        cssClass: 'share-twitter',
        getLink: (title, url) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}&via=CompileExplore`,
        text: 'Tweet',
    },
    reddit: {
        embedValid: false,
        logoClass: 'fab fa-reddit',
        cssClass: 'share-reddit',
        getLink: (title, url) => `http://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
        text: 'Share on Reddit',
    },
};

export class Sharing {
    private layout: GoldenLayout;
    private lastState: any;

    private share: JQuery;
    private shareShort: JQuery;
    private shareFull: JQuery;
    private shareEmbed: JQuery;

    constructor(layout: any) {
        this.layout = layout;
        this.lastState = null;

        this.share = $('#share');
        this.shareShort = $('#shareShort');
        this.shareFull = $('#shareFull');
        this.shareEmbed = $('#shareEmbed');

        this.initButtons();
        this.initCallbacks();
    }

    private initCallbacks(): void {
        this.layout.eventHub.on('displaySharingPopover', () => this.shareShort.trigger('click'));
        this.layout.on('stateChanged', this.onStateChanged.bind(this));

        $('#sharelinkdialog').on('show.bs.modal', this.onOpenModalPane.bind(this));
    }

    private onStateChanged(): void {
        const config = Sharing.filterComponentState(this.layout.toConfig());
        this.ensureUrlIsNotOutdated(config);
        if (options.embedded) {
            const strippedToLast = window.location.pathname.substr(0, window.location.pathname.lastIndexOf('/') + 1);
            $('a.link').prop('href', strippedToLast + '#' + url.serialiseState(config));
        }
    }

    private ensureUrlIsNotOutdated(config: any): void {
        const stringifiedConfig = JSON.stringify(config);
        if (stringifiedConfig !== this.lastState) {
            if (this.lastState != null && window.location.pathname !== window.httpRoot) {
                window.history.replaceState(null, null, window.httpRoot);
            }
            this.lastState = stringifiedConfig;
        }
    }

    private static bindToLinkType(bind: string): LinkType {
        switch (bind) {
            case 'Full': return LinkType.Full;
            case 'Short': return LinkType.Short;
            case 'Embed': return LinkType.Embed;
            default: return LinkType.Full;
        }
    }

    private onOpenModalPane(event: TriggeredEvent<HTMLElement, undefined, HTMLElement, HTMLElement>): void {
        // @ts-ignore The property is added by bootstrap
        const button = $(event.relatedTarget);
        const currentBind = Sharing.bindToLinkType(button.data('bind'));
        const modal = $(event.currentTarget);
        const socialSharingElements = modal.find('.socialsharing');
        const permalink = modal.find('.permalink');
        const embedsettings = modal.find('#embedsettings');

        const updatePermaLink = () => {
            socialSharingElements.empty();
            const config = this.layout.toConfig();
            Sharing.getLinks(config, currentBind, (error: any, newUrl: string, extra: string, updateState: boolean) => {
                if (error || !newUrl) {
                    permalink.prop('disabled', true);
                    permalink.val(error || 'Error providing URL');
                    Sentry.captureException(error);
                } else {
                    if (updateState) {
                        Sharing.storeCurrentConfig(config, extra);
                    }
                    permalink.val(newUrl);
                    if (options.sharingEnabled) {
                        Sharing.updateShares(socialSharingElements, newUrl);
                        // Disable the links for every share item which does not support embed html as links
                        if (currentBind === LinkType.Embed) {
                            socialSharingElements.children('.share-no-embeddable')
                                .addClass('share-disabled')
                                .prop('title', 'Embed links are not supported in this service')
                                .on('click', false);
                        }
                    }
                }
            });
        }

        if (currentBind === LinkType.Embed) {
            embedsettings.show();
            embedsettings.find('input')
                // Off any prev click handlers to avoid multiple events triggering after opening the modal more than once
                .off('click')
                .on('click', () => updatePermaLink());
        } else {
            embedsettings.hide();
        }

        updatePermaLink();

        ga.proxy('send', {
            hitType: 'event',
            eventCategory: 'OpenModalPane',
            eventAction: 'Sharing',
        });
    }

    private initButtons(): void {
        const shareShortCopyToClipBtn = this.shareShort.find('.clip-icon');
        const shareFullCopyToClipBtn = this.shareFull.find('.clip-icon');
        const shareEmbedCopyToClipBtn = this.shareEmbed.find('.clip-icon');

        if (Sharing.areClipboardOperationSupported()) {
            shareShortCopyToClipBtn.on('click', (e) => this.onClipButtonPressed(e, LinkType.Short));
            shareFullCopyToClipBtn.on('click', (e) => this.onClipButtonPressed(e, LinkType.Full));
            shareEmbedCopyToClipBtn.on('click', (e) => this.onClipButtonPressed(e, LinkType.Embed));
        } else {
            shareShortCopyToClipBtn.hide();
            shareFullCopyToClipBtn.hide();
            shareEmbedCopyToClipBtn.hide();
        }
    }

    private onClipButtonPressed(event: ClickEvent, type: LinkType): void {
        // Dont let the modal show up.
        // We need this because the button is a child of the dropdown-item with a data-toggle=modal
        event.stopPropagation();
        this.copyLinkTypeToClipboard(type);
        // As we prevented bubbling, the dropdown won't close by itself. We need to trigger it manually
        this.share.dropdown('hide');
    }

    private copyLinkTypeToClipboard(type: LinkType): void {
        const config = this.layout.toConfig();
        Sharing.getLinks(config, type, (error: any, newUrl: string, extra: string, updateState: boolean) => {
            if (error || !newUrl) {
                this.displayTooltip('Oops, something went wrong');
                Sentry.captureException(error);
            } else {
                if (updateState) {
                    Sharing.storeCurrentConfig(config, extra);
                }
                this.doLinkCopyToClipboard(newUrl);
            }
        });
    }

    private displayTooltip(message: string): void {
        this.share.tooltip('dispose');
        this.share.tooltip({
            placement: 'bottom',
            trigger: 'manual',
            title: message,
        });
        this.share.tooltip('show');
        // Manual triggering of tooltips does not hide them automatically. This timeout ensures they do
        setTimeout(() => this.share.tooltip('hide'), 1500);
    }

    private doLinkCopyToClipboard(link: string): any {
        // TODO: Add more ways for users to be able to copy the link text
        // Right now, only the newer navigator.clipboard is available, but more can be added
        if (Sharing.isNavigatorClipboardAvailable()) {
            navigator.clipboard.writeText(link)
                .then(() => this.displayTooltip('Link copied to clipboard'))
                .catch(() => this.displayTooltip('Error copying link to clipboard'));
        }
    }

    public static getLinks(config: any, currentBind: LinkType, done: CallableFunction): void {
        const root = window.httpRoot;
        ga.proxy('send', {
            hitType: 'event',
            eventCategory: 'CreateShareLink',
            eventAction: 'Sharing',
        });
        switch (currentBind) {
            case LinkType.Short:
                Sharing.getShortLink(config, root, done);
                return;
            case LinkType.Full:
                done(null, window.location.origin + root + '#' + url.serialiseState(config), false);
                return;
            case LinkType.Embed:
                const options = {};
                $('#sharelinkdialog input:checked').each((i, element) => {
                    options[$(element).prop('class')] = true;
                });
                done(null, Sharing.getEmbeddedHtml(config, root, false, options), false);
                return;
            default:
                // Hmmm
                done('Unknown link type', null);
        }
    }

    private static getShortLink(config: any, root: string, done: CallableFunction): void {
        const useExternalShortener = options.urlShortenService !== 'default';
        const data = JSON.stringify({
            config: useExternalShortener ? url.serialiseState(config) : config,
        });
        $.ajax({
            type: 'POST',
            url: window.location.origin + root + 'api/shortener',
            dataType: 'json',  // Expected
            contentType: 'application/json',  // Sent
            data: data,
            success: (result: any) => {
                const pushState = useExternalShortener ? null : result.url;
                done(null, result.url, pushState, true);
            },
            error: (err) => {
                // Notify the user that we ran into trouble?
                done(err.statusText, null, false);
            },
            cache: true,
        });
    }

    private static getEmbeddedHtml(config, root, isReadOnly, extraOptions): string {
        const embedUrl = Sharing.getEmbeddedUrl(config, root, isReadOnly, extraOptions);
        return `<iframe width="800px" height="200px" src="${embedUrl}"></iframe>`;
    }

    private static getEmbeddedUrl(config: any, root: string, readOnly: boolean, extraOptions: object): string {
        const location = window.location.origin + root;
        const parameters = _.reduce(extraOptions, (total, value, key): string => {
            if (total === '') {
                total = '?';
            } else {
                total += '&';
            }

            return total + key + '=' + value;
        }, '')

        const path = (readOnly ? 'embed-ro' : 'e') + parameters + '#';

        return location + path + url.serialiseState(config);
    }

    private static storeCurrentConfig(config: any, extra: string): void {
        window.history.pushState(null, null, extra);
    }

    /***
     * True if there's at least one way to copy a link to the user's clipboard.
     * Currently, only navigator.clipboard is supported
     */
    public static areClipboardOperationSupported(): boolean {
        return Sharing.isNavigatorClipboardAvailable();
    };

    private static isNavigatorClipboardAvailable(): boolean {
        return navigator.clipboard != null;
    };

    public static filterComponentState(config: any, keysToRemove: [string] = ['selection']): any {
        function filterComponentStateImpl(component: any) {
            if (component.content) {
                for (let i = 0; i < component.content.length; i++) {
                    filterComponentStateImpl(component.content[i]);
                }
            }

            if (component.componentState) {
                Object.keys(component.componentState)
                    .filter((e) => keysToRemove.includes(e))
                    .forEach((key) => delete component.componentState[key]);
            }
        }

        config = cloneDeep(config);
        filterComponentStateImpl(config);
        return config;
    }

    private static updateShares(container: JQuery, url: string): void {
        const baseTemplate = $('#share-item');
        _.each(shareServices, (service, serviceName) => {
            const newElement = baseTemplate.children('a.share-item').clone();
            if (service.logoClass) {
                newElement.prepend($('<span>')
                    .addClass('dropdown-icon')
                    .addClass(service.logoClass)
                    .prop('title', serviceName)
                );
            }
            if (service.text) {
                newElement.children('span.share-item-text')
                    .text(' ' + service.text);
            }
            newElement
                .prop('href', service.getLink('Compiler Explorer', url))
                .addClass(service.cssClass)
                .toggleClass('share-no-embeddable', !service.embedValid)
                .appendTo(container);
        });
    }
}
