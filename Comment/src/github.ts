// GitHub Actions sets GITHUB_API_URL (also correct for GitHub Enterprise)
const API = (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");

interface IssueComment {
	id: number;
	body?: string;
}

export interface GithubTarget {
	/** "owner/name" */
	repo: string;
	pr: number;
	token: string;
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		...init,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
			"Content-Type": "application/json",
			...init.headers,
		},
	});
	if (!res.ok) {
		throw new Error(`GitHub API ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
	}
	return (await res.json()) as T;
}

/** Find the comment we posted on an earlier run, by its hidden marker. */
export async function findComment(target: GithubTarget, marker: string): Promise<number | null> {
	for (let page = 1; ; page++) {
		const batch = await request<IssueComment[]>(
			target.token,
			`/repos/${target.repo}/issues/${target.pr}/comments?per_page=100&page=${page}`,
		);
		const hit = batch.find((c) => c.body?.includes(marker));
		if (hit) return hit.id;
		if (batch.length < 100) return null;
	}
}

/** Update our existing comment, or create it. Returns the comment id. */
export async function upsertComment(target: GithubTarget, marker: string, body: string): Promise<number> {
	const existing = await findComment(target, marker);
	const json = JSON.stringify({ body });
	if (existing !== null) {
		await request(target.token, `/repos/${target.repo}/issues/comments/${existing}`, { method: "PATCH", body: json });
		return existing;
	}
	const created = await request<IssueComment>(target.token, `/repos/${target.repo}/issues/${target.pr}/comments`, {
		method: "POST",
		body: json,
	});
	return created.id;
}
