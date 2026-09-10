import fetch from 'cross-fetch';

export type PatreonApiVersion = 1 | 2;

export interface IPatreonProfile
{
	userId: string;
	levels: string[];
}

export interface IPatreonApi
{
	readonly version: PatreonApiVersion;
	readonly scopes: string[];

	fetchProfile(accessToken: string): Promise<IPatreonProfile>;
}

interface IPatreonResourceRef
{
	id: string;
	type: string;
}

interface IPatreonResource extends IPatreonResourceRef
{
	attributes?: { [key: string]: any };
	relationships?: { [key: string]: { data?: IPatreonResourceRef | IPatreonResourceRef[] } };
}

interface IPatreonDocument
{
	data?: IPatreonResource;
	included?: IPatreonResource[];
	errors?: any[];
}

/**
 * Patreon invalidates the previous access token every time one is refreshed, so a 401 means the
 * token we sent is dead rather than the user having no rewards. Callers have to tell those apart,
 * otherwise a stale token quietly reads as "not a patron" forever.
 */
export class PatreonUnauthorizedError extends Error
{
	constructor(url: string)
	{
		super(`Patreon rejected the access token for ${url}`);
	}
}

const emptyProfile = (): IPatreonProfile =>
{
	return {
		userId: null,
		levels: []
	};
};

const relatedRefs = (resource: IPatreonResource, relationship: string): IPatreonResourceRef[] =>
{
	const data = resource?.relationships?.[relationship]?.data;

	if (Array.isArray(data))
	{
		return data;
	}

	return data ? [data] : [];
};

const titles = (resources: IPatreonResource[]): string[] =>
{
	return resources
		.map(resource => resource.attributes?.title)
		.filter(title => !!title);
};

const fetchDocument = async (url: string, accessToken: string): Promise<IPatreonDocument> =>
{
	let response: Response;

	try
	{
		response = await fetch(url, {
			headers: {
				authorization: `Bearer ${accessToken}`
			}
		});
	}
	catch (e)
	{
		console.error("AUTH: Patreon request failed", e);

		return {};
	}

	if (response.status === 401)
	{
		throw new PatreonUnauthorizedError(url);
	}

	let document: IPatreonDocument;

	try
	{
		document = await response.json() as IPatreonDocument;
	}
	catch (e)
	{
		console.error(`AUTH: Patreon returned unreadable body (${response.status})`, e);

		return {};
	}

	if (document?.errors?.length)
	{
		// v1 answers 200 with the failure in the body, so the status alone isn't enough.
		if (document.errors.some(error => String(error?.status) === "401"))
		{
			throw new PatreonUnauthorizedError(url);
		}

		console.error("AUTH: Patreon returned errors", JSON.stringify(document.errors));
	}

	return document;
};

class PatreonApiV1 implements IPatreonApi
{
	public readonly version = 1;
	public readonly scopes = ["users", "pledges-to-me", "my-campaign"];

	public async fetchProfile(accessToken: string): Promise<IPatreonProfile>
	{
		const document = await fetchDocument("https://www.patreon.com/api/oauth2/api/current_user", accessToken);

		if (!document.data)
		{
			return emptyProfile();
		}

		return {
			userId: document.data.id,
			levels: PatreonApiV1.getRewardTitles(document)
		};
	}

	private static getRewardTitles(document: IPatreonDocument): string[]
	{
		const included = document.included;
		const pledgeIds = relatedRefs(document.data, "pledges").map(pledge => pledge.id);

		if (!included || !pledgeIds.length)
		{
			return [];
		}

		const rewardIds = included
			.filter(resource => resource.type === "pledge" && pledgeIds.includes(resource.id))
			.map(pledge => relatedRefs(pledge, "reward")[0]?.id)
			.filter(rewardId => !!rewardId);

		return titles(included.filter(resource => resource.type === "reward" && rewardIds.includes(resource.id)));
	}
}

class PatreonApiV2 implements IPatreonApi
{
	public readonly version = 2;

	// Requesting identity.memberships would return the user's memberships to every campaign
	// they back; with identity alone Patreon only returns their membership to our campaign.
	public readonly scopes = ["identity"];

	private static Url = "https://www.patreon.com/api/oauth2/v2/identity";

	public async fetchProfile(accessToken: string): Promise<IPatreonProfile>
	{
		// v2 returns nothing but type and id unless every attribute is asked for by name,
		// and the brackets in the field/include params have to be encoded.
		const query = [
			["include", "memberships.currently_entitled_tiers"],
			["fields[member]", "patron_status"],
			["fields[tier]", "title"]
		]
			.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
			.join("&");

		const document = await fetchDocument(`${PatreonApiV2.Url}?${query}`, accessToken);

		if (!document.data)
		{
			return emptyProfile();
		}

		return {
			userId: document.data.id,
			levels: PatreonApiV2.getEntitledTierTitles(document)
		};
	}

	private static getEntitledTierTitles(document: IPatreonDocument): string[]
	{
		const included = document.included;
		const membershipIds = relatedRefs(document.data, "memberships").map(membership => membership.id);

		if (!included || !membershipIds.length)
		{
			return [];
		}

		const tierIds = included
			.filter(resource => resource.type === "member"
				&& membershipIds.includes(resource.id)
				&& resource.attributes?.patron_status === "active_patron")
			.reduce((ids, member) => ids.concat(relatedRefs(member, "currently_entitled_tiers").map(tier => tier.id)), [] as string[]);

		return titles(included.filter(resource => resource.type === "tier" && tierIds.includes(resource.id)));
	}
}

export const getPatreonApi = (version: PatreonApiVersion): IPatreonApi =>
{
	return version === 2
		? new PatreonApiV2()
		: new PatreonApiV1();
};
