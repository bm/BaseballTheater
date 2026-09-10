import ClientOAuth2 from 'client-oauth2';
import * as crypto from 'crypto';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

import { Config } from '../config/config';
import { Database } from '../DB/Database';
import { getPatreonApi, IPatreonApi, PatreonApiVersion, PatreonUnauthorizedError } from './patreonApi';

interface TokenWithExpires extends ClientOAuth2.Token
{
	expires: Date;
}

interface IUserData
{
	userId: string;
	accessToken: string;
	// Epoch milliseconds. A Date here would come back from the cookie as a string and silently
	// break every comparison made against it.
	accessTokenExpiry: number;
}

interface IAuthStatus
{
	userId: string,
	accessToken: string,
	levels: string[]
}

/**
 * Expiries reach us as epoch numbers, as ISO strings from cookies written before this was
 * normalized, or as an empty object from DynamoDB rows that stored a Date. Anything unreadable
 * becomes null, which callers treat as "unknown" rather than "expired".
 */
const toTimestamp = (value: any): number =>
{
	if (typeof value === "number")
	{
		return isFinite(value) ? value : null;
	}

	if (value instanceof Date || typeof value === "string")
	{
		const parsed = new Date(value).getTime();

		return isNaN(parsed) ? null : parsed;
	}

	return null;
};

class _Auth
{
	public static Instance = new _Auth();

	private static AuthCookieName = "auth";
	private static CookieVersion = "v2";
	private static GcmIvLength = 12;
	private static GcmTagLength = 16;
	private static EncryptionKey: Buffer;

	// Only used when Patreon omits expires_in; its access tokens normally last about a month.
	private static DefaultAccessTokenMs = 1000 * 60 * 60;
	// Refresh slightly early so a request can't race the expiry.
	private static AccessTokenSkewMs = 1000 * 60 * 5;
	// Both windows are rolling, renewed on every status check, so an active session never hits
	// a hard deadline.
	private static RefreshWindowMs = 1000 * 60 * 60 * 24 * 90;
	private static SessionCookieMs = 1000 * 60 * 60 * 24 * 30;

	private readonly id: string;
	private readonly secret: string;
	private readonly api: IPatreonApi;
	private readonly refreshes = new Map<string, Promise<IUserData>>();
	private client: ClientOAuth2;

	private constructor()
	{
		const keysFile = fs.readFileSync(path.resolve(process.cwd(), "./server/config/keys.json"), "utf8");
		const keys = JSON.parse(keysFile)[0];

		const version = _Auth.getApiVersion(keys.patreon);

		// Each API version needs its own OAuth client, since a v1 client cannot request v2 scopes.
		const credentials = version === 2 ? keys.patreon.v2 : keys.patreon;

		this.api = getPatreonApi(version);
		this.id = credentials.id;
		this.secret = credentials.secret;

		console.log(`AUTH: using Patreon API v${version}`);

		_Auth.EncryptionKey = Buffer.from(keys.crypto.key32);
	}

	private static getApiVersion(patreonKeys: any): PatreonApiVersion
	{
		const configured = process.env.PATREON_API_VERSION ?? patreonKeys?.apiVersion;

		if (Number(configured) !== 2)
		{
			return 1;
		}

		if (!patreonKeys?.v2?.id || !patreonKeys?.v2?.secret)
		{
			console.error("AUTH: Patreon API v2 is enabled but keys.patreon.v2 has no id/secret. Falling back to v1.");

			return 1;
		}

		return 2;
	}

	private static getRedirectUri()
	{
		return `${Config.host}/auth/redirect`;
	}

	public initialize()
	{
		this.client = new ClientOAuth2({
			clientId: this.id,
			clientSecret: this.secret,
			accessTokenUri: 'https://www.patreon.com/api/oauth2/token',
			authorizationUri: 'https://www.patreon.com/oauth2/authorize',
			redirectUri: _Auth.getRedirectUri(),
			scopes: this.api.scopes
		})
	}

	public authorize(req: Request, res: Response)
	{
		const state = typeof req.query.state === "string" ? req.query.state : "/";

		const uri = this.client.code.getUri({state});

		res.redirect(uri);
	}

	public async storeUserToken(req: Request, res: Response)
	{
		const user = await this.client.code.getToken(req.originalUrl, {
			redirectUri: _Auth.getRedirectUri()
		}) as TokenWithExpires;

		const profile = await this.api.fetchProfile(user.accessToken);
		const userId = profile.userId;

		if (!userId)
		{
			throw new Error(`Patreon API v${this.api.version} did not return a user for this token`);
		}

		if (!user.refreshToken)
		{
			console.error("AUTH: Patreon returned no refresh token; this session will not renew");
		}

		_Auth.setAuthCookie({
			accessToken: user.accessToken,
			accessTokenExpiry: _Auth.getAccessTokenExpiry(user),
			userId
		}, res);

		await Database.updateUser(userId, {
			accessToken: user.accessToken,
			refresh_token: user.refreshToken,
			refresh_expiry: Date.now() + _Auth.RefreshWindowMs
		});
	}

	/**
	 * client-oauth2 derives `expires` from expires_in and leaves an Invalid Date when the
	 * provider omits it.
	 */
	private static getAccessTokenExpiry(token: TokenWithExpires): number
	{
		return toTimestamp(token.expires) ?? (Date.now() + _Auth.DefaultAccessTokenMs);
	}

	public async getRefreshAuthStatus(req: Request, res: Response): Promise<IAuthStatus>
	{
		if (!req.cookies)
		{
			req.cookies = {};
			console.log("AUTH: no cookies");
		}

		const authStatus: IAuthStatus = {
			accessToken: null,
			levels: [],
			userId: null
		};

		const storedUserData = _Auth.getAuthCookie(req);
		if (!storedUserData)
		{
			// Drop leftover CBC cookies (and anything else we can't read) so they don't linger.
			if (req.cookies[_Auth.AuthCookieName])
			{
				_Auth.clearAuthCookie(res);
			}

			return authStatus;
		}

		const dbUser = await Database.getUser(storedUserData.userId);
		if (!dbUser)
		{
			console.error(`AUTH: no stored record for user ${storedUserData.userId}`);
			_Auth.clearAuthCookie(res);

			return authStatus;
		}

		const now = Date.now();
		const refreshExpiry = toTimestamp(dbUser.refresh_expiry);

		// A null expiry means the record predates numeric expiries, so let the refresh itself
		// decide whether the session is still good.
		if (refreshExpiry !== null && now > refreshExpiry)
		{
			_Auth.clearAuthCookie(res);

			return authStatus;
		}

		let userData = storedUserData;
		let refreshed = false;

		const accessExpiry = toTimestamp(storedUserData.accessTokenExpiry);
		const accessExpired = accessExpiry === null || now > (accessExpiry - _Auth.AccessTokenSkewMs);

		if (accessExpired || !storedUserData.accessToken)
		{
			try
			{
				userData = await this.refreshUser(storedUserData.userId, storedUserData.accessToken, dbUser.refresh_token);
				refreshed = true;
			}
			catch (e)
			{
				console.error("AUTH: token refresh failed", e);

				// The stored refresh token is no longer usable, so drop the cookie instead of
				// leaving the client in a half-signed-in state that retries it forever.
				_Auth.clearAuthCookie(res);

				return authStatus;
			}
		}

		try
		{
			authStatus.levels = await this.getSubscriberLevel(userData.userId, userData.accessToken);
		}
		catch (e)
		{
			if (!(e instanceof PatreonUnauthorizedError))
			{
				// Anything else is Patreon being unavailable, which shouldn't sign anyone out.
				console.error("AUTH: could not read Patreon profile", e);
			}
			else if (refreshed)
			{
				console.error("AUTH: Patreon rejected a token it had just issued");
				_Auth.clearAuthCookie(res);

				return authStatus;
			}
			else
			{
				// Refreshing invalidates the previous access token, so a cookie written before a
				// refresh that happened elsewhere still looks unexpired while being dead. Its
				// expiry will never prompt a refresh on its own, so force one here.
				try
				{
					userData = await this.refreshUser(userData.userId, userData.accessToken, dbUser.refresh_token);
					authStatus.levels = await this.getSubscriberLevel(userData.userId, userData.accessToken);
				}
				catch (retryError)
				{
					console.error("AUTH: could not replace a rejected access token", retryError);
					_Auth.clearAuthCookie(res);

					return authStatus;
				}
			}
		}

		_Auth.setAuthCookie(userData, res);

		authStatus.userId = userData.userId;
		authStatus.accessToken = userData.accessToken;

		return authStatus;
	}

	/**
	 * Patreon invalidates a refresh token the moment it is redeemed, so concurrent requests for
	 * the same user have to share one refresh rather than each spending the stored token.
	 */
	private refreshUser(userId: string, accessToken: string, refreshToken: string): Promise<IUserData>
	{
		const inFlight = this.refreshes.get(userId);
		if (inFlight)
		{
			return inFlight;
		}

		if (!refreshToken)
		{
			return Promise.reject(new Error(`No refresh token stored for user ${userId}`));
		}

		const done = (result: IUserData) =>
		{
			this.refreshes.delete(userId);

			return result;
		};

		const failed = (e: any) =>
		{
			this.refreshes.delete(userId);

			throw e;
		};

		const refresh = this.doRefresh(userId, accessToken, refreshToken).then(done, failed);

		this.refreshes.set(userId, refresh);

		return refresh;
	}

	private async doRefresh(userId: string, accessToken: string, refreshToken: string): Promise<IUserData>
	{
		const created = this.client.createToken(accessToken, {refresh_token: refreshToken});
		const refreshed = await created.refresh() as TokenWithExpires;

		await Database.updateUser(userId, {
			accessToken: refreshed.accessToken,
			// Patreon rotates the refresh token on each use, but keep the old one if it didn't.
			refresh_token: refreshed.refreshToken ?? refreshToken,
			refresh_expiry: Date.now() + _Auth.RefreshWindowMs
		});

		return {
			userId,
			accessToken: refreshed.accessToken,
			accessTokenExpiry: _Auth.getAccessTokenExpiry(refreshed)
		};
	}

	private async getSubscriberLevel(userId: string, accessToken: string): Promise<string[]>
	{
		if (!userId || !accessToken)
		{
			return [];
		}

		const profile = await this.api.fetchProfile(accessToken);

		return profile.levels;
	}

	public async saveSettings(req: Request)
	{
		const storedUserData = _Auth.getAuthCookie(req);
		if (storedUserData)
		{
			await Database.updateUser(storedUserData.userId, {
				settings: req.body as Object
			});
		}
	}

	public async getSettings(req: Request)
	{
		const storedUserData = _Auth.getAuthCookie(req);
		if (storedUserData)
		{
			return await Database.getUser(storedUserData.userId);
		}

		return null;
	}

	public logout(res: Response)
	{
		_Auth.clearAuthCookie(res);
	}

	private static cookieOptions()
	{
		return {
			expires: new Date(Date.now() + _Auth.SessionCookieMs),
			httpOnly: true,
			// Local login is plain http on jlauer.local.
			secure: Config.Environment !== "local",
			sameSite: "lax" as const,
			path: "/"
		};
	}

	private static setAuthCookie(userData: IUserData, res: Response)
	{
		res.cookie(_Auth.AuthCookieName, _Auth.encodeUserInfo(userData), _Auth.cookieOptions());
	}

	private static clearAuthCookie(res: Response)
	{
		const options = _Auth.cookieOptions();

		res.clearCookie(_Auth.AuthCookieName, {
			httpOnly: options.httpOnly,
			secure: options.secure,
			sameSite: options.sameSite,
			path: options.path
		});
	}

	private static getAuthCookie(req: Request): IUserData
	{
		const authCookie = req.cookies[_Auth.AuthCookieName];
		if (!authCookie)
		{
			return null;
		}

		try
		{
			const userData = _Auth.decodeUserInfo(authCookie);

			return userData?.userId ? userData : null;
		}
		catch (e)
		{
			console.error("AUTH: could not read auth cookie", e);

			return null;
		}
	}

	private static encodeUserInfo(userData: IUserData): string
	{
		return _Auth.encrypt(JSON.stringify(userData));
	}

	private static decodeUserInfo(encoded: string): IUserData
	{
		const decrypted = _Auth.decrypt(encoded);

		return JSON.parse(decrypted) as IUserData;
	}

	private static encrypt(o: string | object)
	{
		const text = typeof o === "string" ? o : JSON.stringify(o);
		const iv = crypto.randomBytes(_Auth.GcmIvLength);
		const cipher = crypto.createCipheriv("aes-256-gcm", _Auth.EncryptionKey, iv);
		const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
		const payload = Buffer.concat([iv, encrypted, cipher.getAuthTag()]);

		return `${_Auth.CookieVersion}.${payload.toString("base64")}`;
	}

	private static decrypt(text: string)
	{
		const prefix = `${_Auth.CookieVersion}.`;
		if (!text.startsWith(prefix))
		{
			throw new Error("Unsupported auth cookie version");
		}

		const payload = Buffer.from(text.slice(prefix.length), "base64");
		const minLength = _Auth.GcmIvLength + _Auth.GcmTagLength + 1;
		if (payload.length < minLength)
		{
			throw new Error("Auth cookie is truncated");
		}

		const iv = payload.slice(0, _Auth.GcmIvLength);
		const tag = payload.slice(payload.length - _Auth.GcmTagLength);
		const ciphertext = payload.slice(_Auth.GcmIvLength, payload.length - _Auth.GcmTagLength);
		const decipher = crypto.createDecipheriv("aes-256-gcm", _Auth.EncryptionKey, iv);
		decipher.setAuthTag(tag);

		return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
	}
}

export const Auth = _Auth.Instance;