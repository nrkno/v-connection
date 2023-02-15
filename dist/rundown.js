"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rundown = void 0;
const v_connection_1 = require("./v-connection");
const msehttp_1 = require("./msehttp");
const peptalk_1 = require("./peptalk");
const mse_1 = require("./mse");
const xml_1 = require("./xml");
const uuid = require("uuid");
const util_1 = require("./util");
const ALTERNATIVE_CONCEPT = 'alternative_concept';
class Rundown {
    constructor(mseRep, profile, playlist, description) {
        this.channelMap = {};
        this.mse = mseRep;
        this.profile = profile.startsWith('/config/profiles/') ? profile.slice(17) : profile;
        this.playlist = playlist;
        if (this.playlist.startsWith('{')) {
            this.playlist = this.playlist.slice(1);
        }
        if (this.playlist.endsWith('}')) {
            this.playlist = this.playlist.slice(0, -1);
        }
        this.description = description;
        this.msehttp = (0, msehttp_1.createHTTPContext)(this.profile, this.mse.resthost ? this.mse.resthost : this.mse.hostname, this.mse.restPort);
        this.initialChannelMapPromise = this.buildChannelMap().catch((err) => this.mse.emit('warning', `Failed to build channel map: ${err.message}`));
    }
    get pep() {
        return this.mse.getPep();
    }
    static makeKey(elementId) {
        return (0, v_connection_1.isExternalElement)(elementId)
            ? `${elementId.vcpid}_${elementId.channel ?? ''}`
            : `${elementId.showId}_${elementId.instanceName}`;
    }
    async buildChannelMap(elementId) {
        if (elementId && (0, util_1.has)(this.channelMap, Rundown.makeKey(elementId))) {
            return true;
        }
        await this.mse.checkConnection();
        const elements = elementId ? [elementId] : await this.listExternalElements();
        for (const e of elements) {
            if (typeof e !== 'string') {
                const element = await this.getElement(e);
                this.channelMap[Rundown.makeKey(e)] = {
                    vcpid: e.vcpid,
                    channel: element.channel,
                    refName: (0, util_1.has)(element, 'name') && typeof element.name === 'string' ? element.name : 'ref',
                };
            }
        }
        return elementId ? (0, util_1.has)(this.channelMap, Rundown.makeKey(elementId)) : false;
    }
    ref(elementId, unescape = false) {
        const key = Rundown.makeKey(elementId);
        let str = this.channelMap[key]?.refName || 'ref';
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
    async listTemplates(showId) {
        await this.mse.checkConnection();
        const templateList = await this.pep.getJS(`/storage/shows/{${showId}}/mastertemplates`, 1);
        const flatTemplates = await (0, xml_1.flattenEntry)(templateList.js);
        return Object.keys(flatTemplates).filter((x) => x !== 'name');
    }
    async getTemplate(templateName, showId) {
        await this.mse.checkConnection();
        const template = await this.pep.getJS(`/storage/shows/{${showId}}/mastertemplates/${templateName}`);
        let flatTemplate = await (0, xml_1.flattenEntry)(template.js);
        if (Object.keys(flatTemplate).length === 1) {
            flatTemplate = flatTemplate[Object.keys(flatTemplate)[0]];
        }
        return flatTemplate;
    }
    async createElement(elementId, templateName, textFields, channel) {
        // TODO ensure that a playlist is created with sub-element "elements"
        if ((0, v_connection_1.isInternalElement)(elementId)) {
            await this.assertInternalElementDoesNotExist(elementId);
            return this.createInternalElement(elementId, templateName, textFields, channel);
        }
        else {
            await this.checkChannelMapWasBuilt();
            await this.assertExternalElementDoesNotExist(elementId);
            return this.createExternalElement(elementId);
        }
    }
    async assertInternalElementDoesNotExist(elementId) {
        try {
            await this.getElement(elementId);
            throw new Error(`An internal graphics element with name '${elementId.instanceName}' already exists.`);
        }
        catch (err) {
            if ((0, peptalk_1.getPepErrorMessage)(err).startsWith('An internal graphics element'))
                throw err;
        }
    }
    async createInternalElement(elementId, templateName, textFields, channel) {
        const template = await this.getTemplate(templateName, elementId.showId);
        // console.dir((template[nameOrID] as any).model_xml.model.schema[0].fielddef, { depth: 10 })
        let fielddef;
        if (this.hasModel(template)) {
            fielddef = template.model_xml.model.schema[0].fielddef;
        }
        else {
            throw new Error(`Could not retrieve field definitions for template '${templateName}'. Not creating element '${elementId.instanceName}'.`);
        }
        let fieldNames = fielddef ? fielddef.map((x) => x.$.name) : [];
        let entries = '';
        const data = {};
        if (textFields.length > fieldNames.length) {
            this.mse.emit('warning', `For template '${templateName}' with ${fieldNames.length} field(s), ${textFields.length} fields have been provided.`);
        }
        fieldNames = fieldNames.sort();
        for (let x = 0; x < fieldNames.length; x++) {
            entries += `    <entry name="${fieldNames[x]}">${textFields[x] ?? ''}</entry>\n`;
            data[fieldNames[x]] = textFields[x] ?? '';
        }
        const vizProgram = channel ? ` viz_program="${channel}"` : '';
        await this.pep.insert(`/storage/shows/{${elementId.showId}}/elements/${elementId.instanceName}`, `<element name="${elementId.instanceName}" guid="${uuid.v4()}" updated="${new Date().toISOString()}" creator="${mse_1.CREATOR_NAME}" ${vizProgram}>
<ref name="master_template">/storage/shows/{${elementId.showId}}/mastertemplates/${templateName}</ref>
<entry name="default_alternatives"/>
<entry name="data">
${entries}
</entry>
</element>`, peptalk_1.LocationType.Last);
        return {
            name: elementId.instanceName,
            template: templateName,
            data,
            channel,
        };
    }
    hasModel(template) {
        return ((0, util_1.has)(template, 'model_xml') &&
            typeof template.model_xml === 'object' &&
            (0, util_1.has)(template.model_xml, 'model') &&
            typeof template.model_xml.model === 'object');
    }
    async assertExternalElementDoesNotExist(elementId) {
        try {
            await this.getElement(elementId);
            throw new Error(`An external graphics element with name '${elementId.vcpid}' already exists.`);
        }
        catch (err) {
            if ((0, peptalk_1.getPepErrorMessage)(err).startsWith('An external graphics element'))
                throw err;
        }
    }
    async checkChannelMapWasBuilt() {
        try {
            await this.initialChannelMapPromise;
        }
        catch (err) {
            this.mse.emit('warning', `createElement: Channel map not built: ${(0, peptalk_1.getPepErrorMessage)(err)}`);
        }
    }
    async createExternalElement(elementId) {
        const vizProgram = elementId.channel ? ` viz_program="${elementId.channel}"` : '';
        const { body: path } = await this.pep.insert(`/storage/playlists/{${this.playlist}}/elements/`, `<ref available="0.00" loaded="0.00" take_count="0"${vizProgram}>/external/pilotdb/elements/${elementId.vcpid}</ref>`, peptalk_1.LocationType.Last);
        this.channelMap[Rundown.makeKey(elementId)] = {
            vcpid: elementId.vcpid,
            channel: elementId.channel,
            refName: path ? path.slice(path.lastIndexOf('/') + 1) : 'ref',
        };
        return {
            vcpid: elementId.vcpid.toString(),
            channel: elementId.channel,
        };
    }
    async listInternalElements(showId) {
        await this.mse.checkConnection();
        const pepResponseJS = await this.pep.getJS(`/storage/shows/${(0, util_1.wrapInBracesIfNeeded)(showId)}/elements`, 1);
        const flatEntry = await (0, xml_1.flattenEntry)(pepResponseJS.js);
        const elementsParentNode = flatEntry['elements'];
        return Object.keys(elementsParentNode)
            .filter((x) => x !== 'name')
            .map((elementName) => ({
            instanceName: elementName,
            showId,
            creator: elementsParentNode[elementName].creator,
        }));
    }
    async listExternalElements() {
        await this.mse.checkConnection();
        const playlistElementsList = await this.pep.getJS(`/storage/playlists/{${this.playlist}}/elements`, 2);
        const flatPlaylistElements = await (0, xml_1.flattenEntry)(playlistElementsList.js);
        const elementsRefs = flatPlaylistElements.elements
            ? Object.keys(flatPlaylistElements.elements).map((k) => {
                const entry = flatPlaylistElements.elements[k];
                const ref = entry.value;
                const lastSlash = ref.lastIndexOf('/');
                return { vcpid: +ref.slice(lastSlash + 1), channel: entry.viz_program };
            })
            : [];
        return elementsRefs;
    }
    async initializeShow(showId) {
        return this.msehttp.initializeShow(showId);
    }
    async cleanupShow(showId) {
        return this.msehttp.cleanupShow(showId);
    }
    async cleanupAllSofieShows() {
        const showIds = await this.findAllSofieShowIds();
        await this.purgeInternalElements(showIds, false);
        return Promise.all(showIds.map(async (showId) => this.cleanupShow(showId)));
    }
    async findAllSofieShowIds() {
        await this.mse.checkConnection();
        const pepResponseJS = await this.pep.getJS(`/storage/shows`, 1);
        const shows = await (0, xml_1.flattenEntry)(pepResponseJS.js);
        const settledResultShowIds = await Promise.allSettled(Object.keys(shows).map(this.isSofieShow.bind(this)));
        return this.reduceSettledResultToShowIds(settledResultShowIds).map(this.stripCurlyBrackets.bind(this));
    }
    async isSofieShow(showId) {
        const elements = await this.listInternalElements(showId);
        return elements.find((element) => element.creator === mse_1.CREATOR_NAME)
            ? Promise.resolve(showId)
            : Promise.reject();
    }
    reduceSettledResultToShowIds(settledResultShowIds) {
        return settledResultShowIds.reduce((showIds, promise) => {
            if (promise.status === 'fulfilled') {
                return [...showIds, promise.value];
            }
            return showIds;
        }, []);
    }
    stripCurlyBrackets(value) {
        return value.replace('{', '').replace('}', '');
    }
    async activate(twice, initPlaylist = true) {
        let result = {
            // Returned when initShow = false and initPlaylist = false
            path: '/',
            status: 200,
            response: 'No commands to run.',
        };
        if (twice && initPlaylist) {
            result = await this.msehttp.initializePlaylist(this.playlist);
        }
        if (initPlaylist) {
            result = await this.msehttp.initializePlaylist(this.playlist);
        }
        return result;
    }
    async deactivate() {
        return this.msehttp.cleanupPlaylist(this.playlist);
    }
    async deleteElement(elementId) {
        if ((0, v_connection_1.isInternalElement)(elementId)) {
            return this.pep.delete(`/storage/shows/{${elementId.showId}}/elements/${elementId.instanceName}`);
        }
        else {
            // Note: For some reason, in contrast to the other commands, the delete command only works with the path being unescaped:
            const path = this.getExternalElementPath(elementId, true);
            if (await this.buildChannelMap(elementId)) {
                return this.pep.delete(path);
            }
            else {
                throw new peptalk_1.InexistentError(-1, path);
            }
        }
    }
    async cue(elementId) {
        if ((0, v_connection_1.isInternalElement)(elementId)) {
            return this.msehttp.cue(`/storage/shows/{${elementId.showId}}/elements/${elementId.instanceName}`);
        }
        else {
            const path = this.getExternalElementPath(elementId);
            if (await this.buildChannelMap(elementId)) {
                return this.msehttp.cue(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot cue external element as ID '${elementId.vcpid}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async take(elementId) {
        if ((0, v_connection_1.isInternalElement)(elementId)) {
            return this.msehttp.take(`/storage/shows/{${elementId.showId}}/elements/${elementId.instanceName}`);
        }
        else {
            const path = this.getExternalElementPath(elementId);
            if (await this.buildChannelMap(elementId)) {
                return this.msehttp.take(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot take external element as ID '${elementId.vcpid}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async continue(elementId) {
        if ((0, v_connection_1.isInternalElement)(elementId)) {
            return this.msehttp.continue(`/storage/shows/{${elementId.showId}}/elements/${elementId.instanceName}`);
        }
        else {
            const path = this.getExternalElementPath(elementId);
            if (await this.buildChannelMap(elementId)) {
                return this.msehttp.continue(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot continue external element as ID '${elementId.vcpid}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async continueReverse(elementId) {
        if ((0, v_connection_1.isInternalElement)(elementId)) {
            return this.msehttp.continueReverse(`/storage/shows/{${elementId.showId}}/elements/${elementId.instanceName}`);
        }
        else {
            const path = this.getExternalElementPath(elementId);
            if (await this.buildChannelMap(elementId)) {
                return this.msehttp.continueReverse(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot continue reverse external element as ID '${elementId.vcpid}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async out(elementId) {
        if ((0, v_connection_1.isInternalElement)(elementId)) {
            return this.msehttp.out(`/storage/shows/{${elementId.showId}}/elements/${elementId.instanceName}`);
        }
        else {
            const path = this.getExternalElementPath(elementId);
            if (await this.buildChannelMap(elementId)) {
                return this.msehttp.out(path);
            }
            else {
                throw new msehttp_1.HTTPRequestError(`Cannot take out external element as ID '${elementId.vcpid}' is not known in this rundown.`, this.msehttp.baseURL, path);
            }
        }
    }
    async initialize(elementId) {
        const path = this.getExternalElementPath(elementId);
        if (await this.buildChannelMap(elementId)) {
            return this.msehttp.initialize(path);
        }
        else {
            throw new msehttp_1.HTTPRequestError(`Cannot initialize external element as ID '${elementId.vcpid}' is not known in this rundown.`, this.msehttp.baseURL, path);
        }
    }
    async purgeInternalElements(showIds, onlyCreatedByUs, elementsToKeep = []) {
        const elementsToKeepSet = new Set(elementsToKeep.map((e) => {
            return Rundown.makeKey(e);
        }));
        for (const showId of showIds) {
            const elements = await this.listInternalElements(showId);
            await Promise.all(elements.map(async (element) => {
                if ((!onlyCreatedByUs || element.creator === mse_1.CREATOR_NAME) &&
                    !elementsToKeepSet.has(Rundown.makeKey(element))) {
                    await this.deleteElement(element);
                }
            }));
        }
        return { id: '*', status: 'ok' };
    }
    async purgeExternalElements(elementsToKeep = []) {
        await this.buildChannelMap();
        const elementsSet = new Set(elementsToKeep.map((e) => {
            return Rundown.makeKey(e);
        }));
        await Promise.all(Object.keys(this.channelMap).map(async (key) => {
            if (elementsSet.has(key))
                return;
            try {
                await this.deleteElement(this.channelMap[key]);
            }
            catch (e) {
                if (!(e instanceof peptalk_1.InexistentError)) {
                    throw e;
                }
            }
        }));
        return { id: '*', status: 'ok' };
    }
    async getElement(elementId) {
        await this.mse.checkConnection();
        if ((0, v_connection_1.isExternalElement)(elementId)) {
            const playlistsList = await this.pep.getJS(`/storage/playlists/{${this.playlist}}/elements`, 2);
            const flatPlaylistElements = await (0, xml_1.flattenEntry)(playlistsList.js);
            const elementKey = Object.keys(flatPlaylistElements.elements).find((k) => {
                const elem = flatPlaylistElements.elements[k];
                const ref = elem.value;
                return ref.endsWith(`/${elementId.vcpid}`) && (!elementId.channel || elem.viz_program === elementId.channel);
            });
            const element = typeof elementKey === 'string'
                ? flatPlaylistElements.elements[elementKey]
                : undefined;
            if (!element) {
                throw new peptalk_1.InexistentError(typeof playlistsList.id === 'number' ? playlistsList.id : 0, `/storage/playlists/{${this.playlist}}/elements#${elementId.vcpid}`);
            }
            else {
                element.vcpid = elementId.vcpid.toString();
                element.channel = element.viz_program;
                element.name = elementKey && elementKey !== '0' ? elementKey.replace('#', '%23') : 'ref';
                return element;
            }
        }
        else {
            const element = await this.pep.getJS(`/storage/shows/{${elementId.showId}}/elements/${elementId.instanceName}`);
            const flatElement = (await (0, xml_1.flattenEntry)(element.js))[elementId.instanceName];
            flatElement.name = elementId.instanceName;
            return flatElement;
        }
    }
    async isActive() {
        const playlist = await this.mse.getPlaylist(this.playlist);
        return playlist.active_profile && typeof playlist.active_profile.value !== 'undefined';
    }
    getExternalElementPath(elementId, unescape = false) {
        return `/storage/playlists/{${this.playlist}}/elements/${this.ref(elementId, unescape)}`;
    }
    async setAlternativeConcept(value) {
        const environmentPath = `/storage/playlists/${(0, util_1.wrapInBracesIfNeeded)(this.playlist)}/environment`;
        const alternativeConceptEntry = `<entry name="${ALTERNATIVE_CONCEPT}">${value}</entry>`;
        // Environment entry must exists!
        await this.pep.ensurePath(environmentPath);
        await this.pep.replace(`${environmentPath}/${ALTERNATIVE_CONCEPT}`, alternativeConceptEntry);
    }
}
exports.Rundown = Rundown;
//# sourceMappingURL=rundown.js.map