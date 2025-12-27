const fs = require('fs');

async function fetchReadmeContent(owner, repoName, token) {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/readme`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3.raw'
      }
    });
    if (response.ok) {
      const content = await response.text();
      return content.slice(0, 1500);
    }
    return null;
  } catch (e) {
    console.log(`Could not fetch README for ${repoName}:`, e.message);
    return null;
  }
}

async function fetchRecentCommits(owner, repoName, token) {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/commits?per_page=5`, {
      headers: { 'Authorization': `token ${token}` }
    });
    if (response.ok) {
      const commits = await response.json();
      return commits.map(c => c.commit.message.split('\n')[0]).slice(0, 5);
    }
    return [];
  } catch (e) {
    return [];
  }
}

function buildRepoSection(r) {
  const topics = r.topics.join(', ') || 'None';
  const commits = r.recentCommits.join(' | ') || 'None';
  return `
--- ${r.name} ---
Language: ${r.language}
Topics: ${topics}
Original Description: ${r.description}
Recent Commits: ${commits}
README Preview:
${r.readme}
`;
}

async function main() {
  const owner = 'juanezamudio';
  const token = process.env.GITHUB_TOKEN;

  const reposResponse = await fetch(`https://api.github.com/users/${owner}/repos?sort=pushed&direction=desc&per_page=15`, {
    headers: { 'Authorization': `token ${token}` }
  });
  const allRepos = await reposResponse.json();

  const excludeRepos = ['.github', 'dotfiles', 'juanezamudio', 'github-readme-stats', 'github-profile-trophy'];
  const recentRepos = allRepos
    .filter(repo => !excludeRepos.includes(repo.name) && !repo.fork)
    .slice(0, 4);

  console.log('Processing repos:', recentRepos.map(r => r.name));

  const repoDetails = await Promise.all(recentRepos.map(async (repo) => {
    const [readme, commits] = await Promise.all([
      fetchReadmeContent(owner, repo.name, token),
      fetchRecentCommits(owner, repo.name, token)
    ]);
    return {
      name: repo.name,
      description: repo.description || 'No description provided',
      language: repo.language || 'Unknown',
      url: repo.html_url,
      topics: repo.topics || [],
      readme: readme || 'No README available',
      recentCommits: commits
    };
  }));

  console.log('Fetched details for repos');

  const repoSections = repoDetails.map(buildRepoSection).join('\n');

  const prompt = `You are helping update a GitHub profile README's "Currently Working On" section.

For each repository below, I'm providing the README content and recent commits so you can understand what the project actually does.

Generate for each repo:
1. A single relevant emoji that best represents the project's purpose
2. A concise but informative description (15-25 words) that accurately describes what the project does and its current state

REPOSITORIES:
${repoSections}

Respond in JSON format only, no markdown code blocks:
[{"name": "repo-name", "emoji": "🔨", "description": "A detailed description based on the README content"}, ...]`;

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.5 }
      })
    }
  );

  const geminiData = await geminiResponse.json();
  let aiOutput;

  try {
    const responseText = geminiData.candidates[0].content.parts[0].text;
    const cleanJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    aiOutput = JSON.parse(cleanJson);
    console.log('AI output:', aiOutput);
  } catch (e) {
    console.log('AI parsing failed, using fallback:', e.message);
    console.log('Raw response:', JSON.stringify(geminiData, null, 2));
    aiOutput = recentRepos.map(repo => ({
      name: repo.name,
      emoji: '🔨',
      description: repo.description || `Working on ${repo.name.replace(/-/g, ' ')}`
    }));
  }

  let newSection = '## 🔭 Currently Working On\n\n';
  for (const repo of recentRepos) {
    const aiRepo = aiOutput.find(r => r.name === repo.name) || { emoji: '🔨', description: repo.description || repo.name };
    newSection += `- ${aiRepo.emoji} [**${repo.name}**](${repo.html_url}) — ${aiRepo.description}\n`;
  }

  const readmePath = 'README.md';
  let readme = fs.readFileSync(readmePath, 'utf8');
  const sectionRegex = /## 🔭 Currently Working On\n\n[\s\S]*?(?=\n---|\n## )/;
  readme = readme.replace(sectionRegex, newSection);
  fs.writeFileSync(readmePath, readme);

  const profileReadmePath = 'profile/README.md';
  if (fs.existsSync(profileReadmePath)) {
    let profileReadme = fs.readFileSync(profileReadmePath, 'utf8');
    profileReadme = profileReadme.replace(sectionRegex, newSection);
    fs.writeFileSync(profileReadmePath, profileReadme);
  }

  console.log('README updated successfully!');
}

main().catch(console.error);
