"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMSE = exports.MSERep = exports.CREATOR_NAME = void 0;
const peptalk_1 = require("./peptalk");
const events_1 = require("events");
const xml_1 = require("./xml");
const rundown_1 = require("./rundown");
const uuid = require("uuid");
const util_1 = require("./util");
exports.CREATOR_NAME = 'Sofie';
class MSERep extends events_1.EventEmitter {
    constructor(hostname, restPort, wsPort, resthost) {
        super();
        this.connection = undefined;
        this.reconnectTimeout = undefined;
        this.lastConnectionAttempt = undefined;
        this.timeoutMS = 3000;
        this.hostname = hostname;
        this.restPort = typeof restPort === 'number' && restPort > 0 ? restPort : 8580;
        this.wsPort = typeof wsPort === 'number' && wsPort > 0 ? wsPort : 8595;
        this.resthost = resthost; // For ngrok testing only
        this.pep = this.initPep();
    }
    initPep() {
        if (this.pep) {
            this.pep.removeAllListeners();
        }
        const pep = (0, peptalk_1.startPepTalk)(this.hostname, this.wsPort);
        pep.on('close', () => this.onPepClose());
        this.lastConnectionAttempt = Date.now();
        this.connection = pep.connect().catch((e) => e);
        return pep;
    }
    onPepClose() {
        if (!this.reconnectTimeout) {
            this.connection = undefined;
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectTimeout = undefined;
                this.pep = this.initPep();
            }, Math.max(2000 - (Date.now() - (this.lastConnectionAttempt ?? 0)), 0));
        }
    }
    async checkConnection() {
        if (this.connection) {
            await this.connection;
        }
        else {
            throw new Error('Attempt to connect to PepTalk server failed.');
        }
    }
    getPep() {
        return this.pep;
    }
    // private readonly sofieShowRE = /<entry name="sofie_show">\/storage\/shows\/\{([^\}]*)\}<\/entry>/
    async getRundowns() {
        await this.checkConnection();
        const playlistList = await this.pep.getJS('/storage/playlists', 3);
        const atomEntry = playlistList.js;
        // Horrible hack ... playlists not following atom pub model
        if (atomEntry.entry) {
            atomEntry.entry.entry = atomEntry.entry.playlist;
            delete atomEntry.entry.playlist;
        }
        const flatList = await (0, xml_1.flattenEntry)(playlistList.js);
        return Object.keys(flatList)
            .filter((k) => k !== 'name' && typeof flatList[k] !== 'string' && flatList[k].sofie_show)
            .map((k) => new rundown_1.Rundown(this, flatList[k].profile, k, flatList[k].description));
    }
    async getRundown(playlistID) {
        const playlist = await this.getPlaylist(playlistID);
        return new rundown_1.Rundown(this, playlist.profile, playlistID, playlist.description);
    }
    async getEngines() {
        await this.checkConnection();
        const handlers = await this.pep.getJS('/scheduler');
        const handlersBody = handlers.js;
        // Sometimes the main node is is called 'scheduler', sometimes 'entry'
        // It doesn't seem to depend on specific version, so let's just support both
        const vizEntries = (handlersBody.entry || handlersBody.scheduler).handler.filter((x) => x.$.type === 'viz');
        const viz = await Promise.all(vizEntries.map(async (x) => (0, xml_1.flattenEntry)(x)));
        return viz;
    }
    async listProfiles() {
        await this.checkConnection();
        const profileList = await this.pep.getJS('/config/profiles', 1);
        const flatList = await (0, xml_1.flattenEntry)(profileList.js);
        return Object.keys(flatList).filter((x) => x !== 'name');
    }
    async getProfile(profileName) {
        await this.checkConnection();
        const profile = await this.pep.getJS(`/config/profiles/${profileName}`);
        const flatProfile = await (0, xml_1.flattenEntry)(profile.js);
        return flatProfile;
    }
    async listShows() {
        await this.checkConnection();
        const showList = await this.pep.getJS('/storage/shows', 1);
        const flatList = await (0, xml_1.flattenEntry)(showList.js);
        return Object.keys(flatList).filter((x) => x !== 'name');
    }
    async listShowsFromDirectory() {
        await this.checkConnection();
        const showList = await this.pep.getJS('/directory/shows');
        const flatMap = await (0, xml_1.toFlatMap)(showList.js);
        this.extractShowIdsFromPaths(flatMap);
        return flatMap;
    }
    extractShowIdsFromPaths(flatMap) {
        for (const [key, value] of flatMap) {
            const showId = value.match(/{(.+)}/);
            if (!showId) {
                // probably some faulty ref
                flatMap.delete(key);
            }
            else {
                flatMap.set(key, showId[1]);
            }
        }
    }
    async getShow(showId) {
        await this.checkConnection();
        const show = await this.pep.getJS(`/storage/shows/${(0, util_1.wrapInBracesIfNeeded)(showId)}`);
        const flatShow = await (0, xml_1.flattenEntry)(show.js);
        return flatShow;
    }
    async listPlaylists() {
        await this.checkConnection();
        const playlistList = await this.pep.getJS('/storage/playlists', 1);
        const atomEntry = playlistList.js;
        // Horrible hack ... playlists not following atom pub model
        if (atomEntry.entry) {
            atomEntry.entry.entry = atomEntry.entry.playlist;
            delete atomEntry.entry.playlist;
        }
        const flatList = await (0, xml_1.flattenEntry)(playlistList.js);
        return Object.keys(flatList).filter((x) => x !== 'name');
    }
    async getPlaylist(playlistName) {
        await this.checkConnection();
        const playlist = await this.pep.getJS(`/storage/playlists/${(0, util_1.wrapInBracesIfNeeded)(playlistName)}`);
        let flatPlaylist = await (0, xml_1.flattenEntry)(playlist.js);
        if (Object.keys(flatPlaylist).length === 1) {
            flatPlaylist = flatPlaylist[Object.keys(flatPlaylist)[0]];
        }
        return flatPlaylist;
    }
    // Rundown basics task
    async createRundown(profileName, playlistID, description) {
        await this.assertProfileExists(profileName);
        description = description ? description : `Sofie Rundown ${new Date().toISOString()}`;
        playlistID = playlistID ? playlistID.toUpperCase() : uuid.v4().toUpperCase();
        if (!(await this.doesPlaylistExist(playlistID, profileName))) {
            await this.createNewPlaylist(playlistID, description, profileName);
            await this.createPlaylistDirectoryReferenceIfMissing(playlistID);
        }
        return new rundown_1.Rundown(this, profileName, playlistID, description);
    }
    async assertProfileExists(profileName) {
        try {
            await this.pep.get(`/config/profiles/${profileName}`, 1);
        }
        catch (err) {
            throw new Error(`The profile with name '${profileName}' for a new rundown does not exist. Error is: ${(0, peptalk_1.getPepErrorMessage)(err)}.`);
        }
    }
    async doesPlaylistExist(playlistID, profileName) {
        const playlist = await this.getPlaylist(playlistID.toUpperCase()).catch(() => undefined);
        if (!playlist) {
            return false;
        }
        if (!playlist.profile.endsWith(`/${profileName}`)) {
            throw new Error(`Referenced playlist exists but references profile '${playlist.profile}' rather than the given '${profileName}'.`);
        }
        return true;
    }
    async createNewPlaylist(playlistID, description, profileName) {
        const modifiedDate = this.getCurrentTimeFormatted();
        await this.pep.insert(`/storage/playlists/{${playlistID}}`, `<playlist description="${description}" modified="${modifiedDate}" profile="/config/profiles/${profileName}" name="{${playlistID}}">
    <elements/>
    <entry name="environment">
        <entry name="alternative_concept"/>
    </entry>
    <entry name="cursors">
        <entry name="globals">
            <entry name="last_taken"/>
            <entry name="last_read"/>
        </entry>
    </entry>
    <entry backing="transient" name="active_profile"/>
    <entry name="meta"/>
    <entry name="settings"/>
    <entry name="ncs_cursor"/>
</playlist>`, peptalk_1.LocationType.Last);
    }
    async createPlaylistDirectoryReferenceIfMissing(playlistID) {
        if (await this.doesPlaylistDirectoryReferenceExists(playlistID)) {
            return;
        }
        await this.insertDirectoryPlaylistReference(playlistID);
    }
    async doesPlaylistDirectoryReferenceExists(playlistID) {
        await this.checkConnection();
        const pepResponseJS = await this.pep.getJS('/directory/playlists/');
        const directoryPlaylistRefs = await (0, xml_1.flattenEntry)(pepResponseJS.js);
        return Object.keys(directoryPlaylistRefs)
            .filter((key) => key.startsWith('ref'))
            .map((key) => directoryPlaylistRefs[key].value)
            .some((refValue) => !!refValue && refValue.includes((0, util_1.wrapInBracesIfNeeded)(playlistID)));
    }
    async insertDirectoryPlaylistReference(playlistID) {
        await this.pep.insert(`/directory/playlists/`, `<ref author="${exports.CREATOR_NAME}" description="${playlistID}">/storage/playlists/${(0, util_1.wrapInBracesIfNeeded)(playlistID)}</ref>`, peptalk_1.LocationType.Last);
    }
    getCurrentTimeFormatted() {
        const date = new Date();
        return `${date.getUTCDate().toString().padStart(2, '0')}.${(date.getUTCMonth() + 1)
            .toString()
            .padStart(2, '0')}.${date.getFullYear()} ${date.getHours().toString().padStart(2, '0')}:${date
            .getMinutes()
            .toString()
            .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
    }
    // Rundown basics task
    async deleteRundown(rundown) {
        const playlist = await this.getPlaylist(rundown.playlist);
        // console.dir(playlist, { depth: 10 })
        if (playlist.active_profile.value) {
            throw new Error(`Cannot delete an active profile.`);
        }
        const delres = await this.pep.delete(`/storage/playlists/{${rundown.playlist}}`);
        return delres.status === 'ok';
    }
    // Advanced feature
    async createProfile(_profileName, _profileDetailsTbc) {
        return Promise.reject(new Error('Not implemented. Creating profiles is a future feature.'));
    }
    // Advanced feature
    async deleteProfile(_profileName) {
        return Promise.reject(new Error('Not implemented. Deleting profiles ia a future feature.'));
    }
    async ping() {
        try {
            const res = await this.pep.ping();
            return { path: 'ping', status: 200, response: res.body };
        }
        catch (err) {
            err.path = 'ping';
            err.status = 418;
            err.response = (0, peptalk_1.getPepErrorMessage)(err);
            throw err;
        }
    }
    async close() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }
        if (this.connection) {
            await this.pep.close();
            return true;
        }
        return false;
    }
    timeout(t) {
        if (typeof t !== 'number')
            return this.timeoutMS;
        return this.pep.setTimeout(t);
    }
}
exports.MSERep = MSERep;
/**
 *  Factory to create an [[MSE]] instance to manage commumication between a Node
 *  application and a Viz Media Sequencer Engine.
 *  @param hostname Hostname or IP address for the instance of the MSE to control.
 *  @param restPort Optional port number for HTTP traffic, is different from the
 *                  default of 8580.
 *  @param wsPort   Optional port number for PepTalk traffic over websockets, if
 *                  different from the default of 8695.
 *  @param resthost Optional different host name for rest connection - for testing
 *                  purposes only.
 *  @return New MSE that will start to initialize a connection based on the parameters.
 */
function createMSE(hostname, restPort, wsPort, resthost) {
    return new MSERep(hostname, restPort, wsPort, resthost);
}
exports.createMSE = createMSE;
//# sourceMappingURL=mse.js.map