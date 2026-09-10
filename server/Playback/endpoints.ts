import {CompilationPlaylists, ITeams, MlbDataServer, NonPlayTags, RecapTags, SinglePlayTags} from "../../baseball-theater-engine";
import {Express, Response} from "express";
import {PlaybackUtils} from "./PlaybackUtils";
import moment from "moment";
import {Teams} from "../../baseball-theater-engine/dist/contract";
import apicache from "apicache";

const cache = apicache.options({
	statusCodes: {
		include: [200]
	}
}).middleware;

const sendOrFail = (res: Response, work: Promise<unknown>) =>
{
	work.then(data => res.send(data)).catch(error =>
	{
		console.error(error);

		if (!res.headersSent)
		{
			res.status(502).json({error: "Upstream request failed"});
		}
	});
};

export const RegisterPlaybackEndpoints = (app: Express) =>
{
	/**
	 * @swagger
	 *
	 * /api/team:
	 *  get:
	 *      description: Returns videos for a particular team
	 *      parameters:
	 *      - in: query
	 *        name: team
	 *        required: true
	 *        description: The team in question (filecode)
	 *      - in: query
	 *        name: sinceDays
	 *        description: The number of days ago to search (max 7)
	 *        type: number
	 *      - in: header
	 *        name: x-api-key
	 *        description: Your API Key
	 *        type: string
	 *      - in: header
	 *        name: x-app
	 *        description: Your app
	 *        type: string
	 */
	app.get("/api/team", cache("1 minute"), (req, res) =>
	{
		PlaybackUtils.requireApiKey(req, res);

		const team = req.query.team as keyof ITeams;
		const page = req.query.page || 1;
		const teamCodeNumber = Teams.TeamIdList[team as keyof typeof Teams.TeamIdList];

		const MLB = new MlbDataServer();
		sendOrFail(res, MLB.videoTagSearchNode(`teamid-${teamCodeNumber}`, page));
	});

	/**
	 * @swagger
	 *
	 * /api/compilations:
	 *  get:
	 *      description: Returns videos that contain multiple plays for a particular theme
	 *      parameters:
	 *      - in: query
	 *        name: type
	 *        required: true
	 *        description: The type of compilation
	 *        schema:
	 *          $ref: '#/definitions/CompilationPlaylists'
	 *      - in: query
	 *        name: sinceDays
	 *        description: The number of days ago to search (max 7)
	 *        type: number
	 *      - in: header
	 *        name: x-api-key
	 *        description: Your API Key
	 *        type: string
	 *      - in: header
	 *        name: x-app
	 *        description: Your app
	 *        type: string
	 */
	app.get("/api/compilations", cache("1 minute"), (req, res) =>
	{
		PlaybackUtils.requireApiKey(req, res);

		const type = req.query.type as CompilationPlaylists;
		const daysParam = req.query.sinceDays || 1;
		const limit = PlaybackUtils.timeLimitFromDayCount(daysParam);

		const MLB = new MlbDataServer();
		sendOrFail(res, PlaybackUtils.getPagesUntilTimeLimit(page => MLB.videoPlaylistSearchNode(type, page), limit)
			.then(data => data.filter(r => moment(r.date).isAfter(limit))));
	});

	/**
	 * @swagger
	 *
	 * /api/recaps:
	 *  get:
	 *      description: Returns videos that contain multiple plays by a particular player
	 *      parameters:
	 *      - in: query
	 *        name: type
	 *        required: true
	 *        description: The type of recap
	 *        schema:
	 *          $ref: '#/definitions/RecapTags'
	 *      - in: query
	 *        name: sinceDays
	 *        description: The number of days ago to search (max 7)
	 *        type: number
	 *      - in: header
	 *        name: x-api-key
	 *        description: Your API Key
	 *        type: string
	 *      - in: header
	 *        name: x-app
	 *        description: Your app
	 *        type: string
	 */
	app.get("/api/recaps", cache("1 minute"), (req, res) =>
	{
		PlaybackUtils.requireApiKey(req, res);

		const type = req.query.type as RecapTags;
		const daysParam = req.query.sinceDays || 1;
		const limit = PlaybackUtils.timeLimitFromDayCount(daysParam);

		const MLB = new MlbDataServer();
		sendOrFail(res, PlaybackUtils.getPagesUntilTimeLimit(page => MLB.videoTagSearchNode(type, page), limit)
			.then(data => data.filter(r => moment(r.date).isAfter(limit))));
	});

	/**
	 * @swagger
	 *
	 * /api/singleplays:
	 *  get:
	 *      description: Returns videos that are specific to a single play
	 *      parameters:
	 *      - in: query
	 *        name: type
	 *        description: The type of play
	 *        required: true
	 *        schema:
	 *          $ref: '#/definitions/SinglePlayTags'
	 *      - in: query
	 *        name: sinceDays
	 *        description: The number of days ago to search (max 7)
	 *        type: number
	 *      - in: header
	 *        name: x-api-key
	 *        description: Your API Key
	 *        type: string
	 *      - in: header
	 *        name: x-app
	 *        description: Your app
	 *        type: string
	 */
	app.get("/api/singleplays", cache("1 minute"), (req, res) =>
	{
		PlaybackUtils.requireApiKey(req, res);

		const type = req.query.type as SinglePlayTags;
		const daysParam = req.query.sinceDays || 1;
		const limit = PlaybackUtils.timeLimitFromDayCount(daysParam);

		const MLB = new MlbDataServer();
		sendOrFail(res, PlaybackUtils.getPagesUntilTimeLimit(page => MLB.videoTagSearchNode(type, page), limit)
			.then(data => data.filter(r => moment(r.date).isAfter(limit))));
	});

	/**
	 * @swagger
	 *
	 * /api/nonplays:
	 *  get:
	 *      description: Returns videos that are not about gameplay
	 *      parameters:
	 *      - in: query
	 *        name: type
	 *        description: The type of play
	 *        required: true
	 *        schema:
	 *          $ref: '#/definitions/SinglePlayTags'
	 *      - in: query
	 *        name: sinceDays
	 *        description: The number of days ago to search (max 7)
	 *        type: number
	 *      - in: header
	 *        name: x-api-key
	 *        description: Your API Key
	 *        type: string
	 *      - in: header
	 *        name: x-app
	 *        description: Your app
	 *        type: string
	 */
	app.get("/api/nonplays", cache("1 minute"), (req, res) =>
	{
		PlaybackUtils.requireApiKey(req, res);

		const type = req.query.type as NonPlayTags;
		const daysParam = req.query.sinceDays || 1;
		const limit = PlaybackUtils.timeLimitFromDayCount(daysParam);

		const MLB = new MlbDataServer();
		sendOrFail(res, PlaybackUtils.getPagesUntilTimeLimit(page => MLB.videoTagSearchNode(type, page), limit)
			.then(data => data.filter(r => moment(r.date).isAfter(limit))));
	});
};