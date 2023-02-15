/// <reference types="node" />
import { MSE, VizEngine, VPlaylist, VProfile, VRundown, VShow } from './v-connection';
import { PepTalkClient, PepTalkJS } from './peptalk';
import { CommandResult } from './msehttp';
import { EventEmitter } from 'events';
export declare const CREATOR_NAME = "Sofie";
export declare class MSERep extends EventEmitter implements MSE {
    readonly hostname: string;
    readonly resthost?: string;
    readonly restPort: number;
    readonly wsPort: number;
    private pep;
    private connection?;
    private reconnectTimeout?;
    private lastConnectionAttempt?;
    constructor(hostname: string, restPort?: number, wsPort?: number, resthost?: string);
    initPep(): PepTalkClient & PepTalkJS;
    onPepClose(): void;
    checkConnection(): Promise<void>;
    getPep(): PepTalkClient & PepTalkJS;
    getRundowns(): Promise<VRundown[]>;
    getRundown(playlistID: string): Promise<VRundown>;
    getEngines(): Promise<VizEngine[]>;
    listProfiles(): Promise<string[]>;
    getProfile(profileName: string): Promise<VProfile>;
    listShows(): Promise<string[]>;
    listShowsFromDirectory(): Promise<Map<string, string>>;
    private extractShowIdsFromPaths;
    getShow(showId: string): Promise<VShow>;
    listPlaylists(): Promise<string[]>;
    getPlaylist(playlistName: string): Promise<VPlaylist>;
    createRundown(profileName: string, playlistID?: string, description?: string): Promise<VRundown>;
    private assertProfileExists;
    private doesPlaylistExist;
    private createNewPlaylist;
    private createPlaylistDirectoryReferenceIfMissing;
    private doesPlaylistDirectoryReferenceExists;
    private insertDirectoryPlaylistReference;
    private getCurrentTimeFormatted;
    deleteRundown(rundown: VRundown): Promise<boolean>;
    createProfile(_profileName: string, _profileDetailsTbc: unknown): Promise<VProfile>;
    deleteProfile(_profileName: string): Promise<boolean>;
    ping(): Promise<CommandResult>;
    close(): Promise<boolean>;
    private timeoutMS;
    timeout(t?: number): number;
}
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
export declare function createMSE(hostname: string, restPort?: number, wsPort?: number, resthost?: string): MSE;
//# sourceMappingURL=mse.d.ts.map