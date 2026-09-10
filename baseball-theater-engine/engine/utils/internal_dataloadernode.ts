import 'abortcontroller-polyfill/dist/polyfill-patch-fetch';

import fetch, { Response } from 'node-fetch';

// MLB's data-service returns a 403 HTML page to the default node-fetch User-Agent.
const MlbRequestHeaders = {
	"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Accept": "application/json"
};

class Internal_DataLoaderNode
{
	public static Instance = new Internal_DataLoaderNode();

	private static async parseJson<T>(response: Response): Promise<T>
	{
		const contentType = response.headers.get("content-type") || "";
		const body = await response.text();

		if (!response.ok || contentType.indexOf("json") === -1)
		{
			throw new Error(`Upstream ${response.status} (${contentType || "unknown type"}): ${body.slice(0, 120)}`);
		}

		return JSON.parse(body) as T;
	}

	private async loadNode<T>(url: string, uniqueRequestType: string = ""): Promise<T>
	{
		return new Promise((resolve: (value: any) => void, reject: (error: any) => void) =>
		{
			const catcher = (error: any) =>
			{
				console.log("error", error);
				if (error.statusText === "abort")
				{
					return;
				}

				reject(error);
			};

			fetch(url, {headers: MlbRequestHeaders})
				.then(response => Internal_DataLoaderNode.parseJson<T>(response))
				.then(myJson => resolve(myJson))
				.catch(catcher);
		});
	}

	public async load<T>(url: string, uniqueRequestType: string = ""): Promise<T>
	{
		const result = await this.loadNode<T>(url, uniqueRequestType);
		if (typeof result === "string")
		{
			if (result.length === 0)
			{
				return null;
			}
			return JSON.parse(result) as T;
		}

		return result as T;
	}
}

export default Internal_DataLoaderNode.Instance;