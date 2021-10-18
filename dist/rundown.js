"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rundown = void 0;
const msehttp_1 = require("./msehttp");
const peptalk_1 = require("./peptalk");
const xml_1 = require("./xml");
const uuid = require("uuid");
class Rundown {
    constructor(mseRep, show, profile, playlist, description) {
        this.channelMap = {};
        this.mse = mseRep;
        this.show = show.startsWith('/storage/shows/') ? show.slice(15) : show;
        if (this.show.startsWith('{')) {
            this.show = this.show.slice(1);
        }
        if (this.show.endsWith('}')) {
            this.show = this.show.slice(0, -1);
        }
        this.profile = profile.startsWith('/config/profiles/') ? profile.slice(17) : profile;
        this.playlist = playlist;
        if (this.playlist.startsWith('{')) {
            this.playlist = this.playlist.slice(1);
        }
        if (this.playlist.endsWith('}')) {
            this.playlist = this.playlist.slice(0, -1);
        }
        this.description = description;
        this.msehttp = msehttp_1.createHTTPContext(this.profile, this.mse.resthost ? this.mse.resthost : this.mse.hostname, this.mse.restPort);
        this.initialChannelMapPromise = this.buildChannelMap().catch((err) => console.error(`Warning: Failed to build channel map: ${err.message}`));
    }
    get pep() {
        return this.mse.getPep();
    }
    static makeKey(vcpid, channel) {
        return `${vcpid}_${channel || ''}`;
    }
    async buildChannelMap(vcpid, channel) {
        if (typeof vcpid === 'number') {
            if (Object.prototype.hasOwnProperty.call(this.channelMap, Rundown.makeKey(vcpid, channel))) {
                return true;
            }
        }
        await this.mse.checkConnection();
        const elements = vcpid ? [{ vcpid, channel }] : await this.listElements();
        for (const e of elements) {
            if (typeof e !== 'string') {
                const element = await this.getElement(e.vcpid, e.channel);
                this.channelMap[Rundown.makeKey(e.vcpid, e.channel)] = {
                    vcpid: e.vcpid,
                    channel: element.channel,
                    refName: Object.prototype.hasOwnProperty.call(element, 'name') && typeof element.name === 'string'
                        ? element.name
                        : 'ref',
                };
            }
        }
        return typeof vcpid === 'number'
            ? Object.prototype.hasOwnProperty.call(this.channelMap, Rundown.makeKey(vcpid, channel))
            : false;
    }
    ref(vcpid, channel, unescape = false) {
        var _a;
        const key = Rundown.makeKey(vcpid, channel);
        let str = ((_a = this.channelMap[key]) === null || _a === void 0 ? void 0 : _a.refName) || 'ref';
        if (unescape) {
            // Return the unescaped string
            str = str.replace('%23', '#');
        }
        else {
            // Return the escaped string
            str = str.replace('#', '%23');
        }
        return str;
    }
    async listTemplates() {
        await this.mse.checkConnection();
        const templateList = await this.pep.getJS(`/storage/shows/{${this.show}}/mastertemplates`, 1);
        const flatTemplates = await xml_1.flattenEntry(templateList.js);
        return Object.keys(flatTemplates).filter((x) => x !== 'name');
    }
    async getTemplate(templateName) {
        await this.mse.checkConnection();
        const template = await this.pep.getJS(`/storage/shows/{${this.show}}/mastertemplates/${templateName}`);
        let flatTemplate = await xml_1.flattenEntry(template.js);
        if (Object.keys(flatTemplate).length === 1) {
            flatTemplate = flatTemplate[Object.keys(flatTemplate)[0]];
        }
        return flatTemplate;
    }
    async createElement(nameOrID, elementNameOrChannel, aliasOrTextFields, channel) {
        // TODO ensure that a playlist is created with sub-element "elements"
        if (typeof nameOrID === 'string') {
            try {
                if (elementNameOrChannel) {
                    await this.getElement(elementNameOrChannel);
                }
                throw new Error(`An internal graphics element with name '${elementNameOrChannel}' already exists.`);
            }
            catch (err) {
                if (err.message.startsWith('An internal graphics element'))
                    throw err;
            }
            const template = await this.getTemplate(nameOrID);
            // console.dir((template[nameOrID] as any).model_xml.model.schema[0].fielddef, { depth: 10 })
            let fielddef;
            if (Object.prototype.hasOwnProperty.call(template, 'model_xml') &&
                typeof template.model_xml === 'object' &&
                Object.prototype.hasOwnProperty.call(template.model_xml, 'model') &&
                typeof template.model_xml.model === 'object') {
                fielddef = template.model_xml.model.schema[0].fielddef;
            }
            else {
                throw new Error(`Could not retrieve field definitions for tempalte '${nameOrID}'. Not creating element '${elementNameOrChannel}'.`);
            }
            let fieldNames = fielddef ? fielddef.map((x) => x.$.name) : [];
            let entries = '';
            const data = {};
            if (Array.isArray(aliasOrTextFields)) {
                if (aliasOrTextFields.length > fieldNames.length) {
                    throw new Error(`For template '${nameOrID}' with ${fieldNames.length} field(s), ${aliasOrTextFields.length} fields have been provided.`);
                }
                fieldNames = fieldNames.sort();
                for (let x = 0; x < fieldNames.length; x++) {
                    entries += `    <entry name="${fieldNames[x]}">${aliasOrTextFields[x] ? aliasOrTextFields[x] : ''}</entry>\n`;
                    data[fieldNames[x]] = aliasOrTextFields[x] ? aliasOrTextFields[x] : '';
                }
            }
            const vizProgram = channel ? ` viz_program="${channel}"` : '';
            await this.pep.insert(`/storage/shows/{${this.show}}/elements/${elementNameOrChannel}`, `<element name="${elementNameOrChannel}" guid="${uuid.v4()}" updated="${new Date().toISOString()}" creator="Sofie" ${vizProgram}>
  <ref name="master_template">/storage/shows/{${this.show}}/mastertemplates/${nameOrID}</ref>
  <entry name="default_alternatives"/>
  <entry name="data">
${entries}
  </entry>
</element>`, peptalk_1.LocationType.Last);
            return {
                name: elementNameOrChannel,
                template: nameOrID,
                data,
                channel,
            };
        }
        if (typeof nameOrID === 'number') {
            try {
                await this.initialChannelMapPromise;
            }
            catch (err) {
                console.error(`Warning: createElement: Channel map not built: ${err.message}`);
            }
            try {
                await this.getElement(nameOrID, elementNameOrChannel);
                throw new Error(`An external graphics element with name '${nameOrID}' already exists.`);
            }
            catch (err) {
                if (err.message.startsWith('An external graphics element'))
                    throw err;
            }
            const vizProgram = elementNameOrChannel ? ` viz_program="${elementNameOrChannel}"` : '';
            const { body: path } = await this.pep.insert(`/storage/playlists/{${this.playlist}}/elements/`, `<ref available="0.00" loaded="0.00" take_count="0"${vizProgram}>/external/pilotdb/elements/${nameOrID}</ref>`, peptalk_1.LocationType.Last);
            this.channelMap[Rundown.makeKey(nameOrID, elementNameOrChannel)] = {
                vcpid: nameOrID,
                channel: elementNameOrChannel,
                refName: path ? path.slice(path.lastIndexOf('/') + 1) : 'ref',
            };
            return {
                vcpid: nameOrID.toString(),
                channel: elementNameOrChannel,
            };
        }
        throw new Error('Create element called with neither a string or numerical reference.');
    }
    async listElements() {
        await this.mse.checkConnection();
        const [showElementsList, playlistElementsList] = await Promise.all([
            this.pep.getJS(`/storage/shows/{${this.show}}/elements`, 1),
            this.pep.getJS(`/storage/playlists/{${this.playlist}}/elements`, 2),
        ]);
        const flatShowElements = await xml_1.flattenEntry(showElementsList.js);
        const elementNames = Object.keys(flatShowElements).filter((x) => x !== 'name');
        const flatPlaylistElements = await xml_1.flattenEntry(playlistElementsList.js);
        const elementsRefs = flatPlaylistElements.elements
            ? Object.keys(flatPlaylistElements.elements).map((k) => {
                const entry = flatPlaylistElements.elements[k];
                const ref = entry.value;
                const lastSlash = ref.lastIndexOf('/');
                return { vcpid: +ref.slice(lastSlash + 1), channel: entry.viz_program };
            })
            : [];
        return elementNames.concat(elementsRefs);
    }
    async activate(twice, initShow = true, initPlaylist = true) {
        let result = {
            // Returned when initShow = false and initPlaylist = false
            path: '/',
            status: 200,
            response: 'No commands to run.',
        };
        if (twice && initShow) {
            result = await this.msehttp.initializeShow(this.show);
        }
        if (twice && initPlaylist) {
            result = await this.msehttp.initializePlaylist(this.playlist);
        }
        if (initShow) {
            result = await this.msehttp.initializeShow(this.show);
        }
        if (initPlaylist) {
            result = await this.msehttp.initializePlaylist(this.playlist);
        }
        return result;
    }
    async deactivate(cleanupShow = true) {
        if (cleanupShow) {
            await this.msehttp.cleanupShow(this.show);
        }
        return this.msehttp.cleanupPlaylist(this.playlist);
    }
    cleanup() {
        return this.msehttp.cleanupShow(this.show);
    }
    async deleteElement(elementName, channel) {
        if (typeof elementName === 'string') {
            return this.pep.delete(`/storage/shows/{${this.show}}/elements/${elementName}`);
        }
        else {
            // Note: For some reason, in contrast to the other commands, the delete command only works with the path being unescaped:
            const path = this.getExternalElementPath(elementName, channel, true);
            if (await this.buildChannelMap(elementName, channel)) {
                return this.pep.delete(path);
            }
            else {
                throw new peptalk_1.InexistentError(-1, path);
            }
        }
    }
    async cue(elementName, channel) {
        if (typeof elementName === 'string') {
            return this.msehttp.cue(`/storage/shows/{${this.show}}/elements/${elementName}`);
        }
        else {
            const path = this.getExternalElementPath(elementName, channel);
            if (await this.buildChannelMap(elementName, channel)) {
                return this.msehttp.cue(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot cue external element as ID '${elementName}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async take(elementName, channel) {
        if (typeof elementName === 'string') {
            return this.msehttp.take(`/storage/shows/{${this.show}}/elements/${elementName}`);
        }
        else {
            const path = this.getExternalElementPath(elementName, channel);
            if (await this.buildChannelMap(elementName, channel)) {
                return this.msehttp.take(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot take external element as ID '${elementName}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async continue(elementName, channel) {
        if (typeof elementName === 'string') {
            return this.msehttp.continue(`/storage/shows/{${this.show}}/elements/${elementName}`);
        }
        else {
            const path = this.getExternalElementPath(elementName, channel);
            if (await this.buildChannelMap(elementName, channel)) {
                return this.msehttp.continue(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot continue external element as ID '${elementName}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async continueReverse(elementName, channel) {
        if (typeof elementName === 'string') {
            return this.msehttp.continueReverse(`/storage/shows/{${this.show}}/elements/${elementName}`);
        }
        else {
            const path = this.getExternalElementPath(elementName, channel);
            if (await this.buildChannelMap(elementName, channel)) {
                return this.msehttp.continueReverse(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot continue reverse external element as ID '${elementName}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async out(elementName, channel) {
        if (typeof elementName === 'string') {
            return this.msehttp.out(`/storage/shows/{${this.show}}/elements/${elementName}`);
        }
        else {
            const path = this.getExternalElementPath(elementName, channel);
            if (await this.buildChannelMap(elementName, channel)) {
                return this.msehttp.out(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot take out external element as ID '${elementName}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async initialize(elementName, channel) {
        const path = this.getExternalElementPath(elementName, channel);
        if (await this.buildChannelMap(elementName, channel)) {
            return this.msehttp.initialize(path);
        }
        else {
            throw new msehttp_1.HTTPRequestError(`Cannot initialize external element as ID '${elementName}' is not known in this rundown.`, this.msehttp.baseURL, path);
        }
    }
    async purge(elementsToKeep) {
        // let playlist = await this.mse.getPlaylist(this.playlist)
        // if (playlist.active_profile.value) {
        // 	throw new Error(`Cannot purge an active profile.`)
        // }
        await this.pep.replace(`/storage/shows/{${this.show}}/elements`, '<elements/>');
        if (elementsToKeep && elementsToKeep.length) {
            await this.buildChannelMap();
            const elementsSet = new Set(elementsToKeep.map((e) => {
                return Rundown.makeKey(e.vcpid, e.channel);
            }));
            for (const key in this.channelMap) {
                if (!elementsSet.has(key)) {
                    try {
                        await this.deleteElement(this.channelMap[key].vcpid, this.channelMap[key].channel);
                    }
                    catch (e) {
                        if (!(e instanceof peptalk_1.InexistentError)) {
                            throw e;
                        }
                    }
                }
            }
        }
        else {
            await this.pep.replace(`/storage/playlists/{${this.playlist}}/elements`, '<elements/>');
        }
        return { id: '*', status: 'ok' };
    }
    async getElement(elementName, channel) {
        await this.mse.checkConnection();
        if (typeof elementName === 'number') {
            const playlistsList = await this.pep.getJS(`/storage/playlists/{${this.playlist}}/elements`, 2);
            const flatPlaylistElements = await xml_1.flattenEntry(playlistsList.js);
            const elementKey = Object.keys(flatPlaylistElements.elements).find((k) => {
                const elem = flatPlaylistElements.elements[k];
                const ref = elem.value;
                return ref.endsWith(`/${elementName}`) && (!channel || elem.viz_program === channel);
            });
            const element = typeof elementKey === 'string'
                ? flatPlaylistElements.elements[elementKey]
                : undefined;
            if (!element) {
                throw new peptalk_1.InexistentError(typeof playlistsList.id === 'number' ? playlistsList.id : 0, `/storage/playlists/{${this.playlist}}/elements#${elementName}`);
            }
            else {
                element.vcpid = elementName.toString();
                element.channel = element.viz_program;
                element.name = elementKey && elementKey !== '0' ? elementKey.replace('#', '%23') : 'ref';
                return element;
            }
        }
        else {
            const element = await this.pep.getJS(`/storage/shows/{${this.show}}/elements/${elementName}`);
            const flatElement = (await xml_1.flattenEntry(element.js))[elementName];
            flatElement.name = elementName;
            return flatElement;
        }
    }
    async isActive() {
        const playlist = await this.mse.getPlaylist(this.playlist);
        return playlist.active_profile && typeof playlist.active_profile.value !== 'undefined';
    }
    getExternalElementPath(elementName, channel, unescape = false) {
        return `/storage/playlists/{${this.playlist}}/elements/${this.ref(elementName, channel, unescape)}`;
    }
}
exports.Rundown = Rundown;
//# sourceMappingURL=rundown.js.map