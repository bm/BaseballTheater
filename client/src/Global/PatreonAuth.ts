// The server builds the actual Patreon URL so the client id and v2 scopes only live in keys.json.
// This has to be an absolute URL because in dev the express server is on a different port than CRA.
export const getPatreonAuthUrl = () =>
{
	const isLocal = window.location.hostname === "jlauer.local";
	const host = isLocal ? "jlauer.local:8000" : window.location.hostname;
	const protocol = isLocal ? "http:" : "https:";
	const state = encodeURIComponent(window.location.pathname);

	return `${protocol}//${host}/auth/authorize?state=${state}`;
};
