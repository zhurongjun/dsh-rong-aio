export const PROVIDER_ICON_IDS = [
  'ai21',
  'ai302',
  'aihubmix',
  'alibabacloud',
  'antgroup',
  'anthropic',
  'aws',
  'azure',
  'azureai',
  'baichuan',
  'baiducloud',
  'bailian',
  'baseten',
  'bedrock',
  'burncloud',
  'cerebras',
  'chatglm',
  'chutes',
  'claude',
  'cloudflare',
  'cohere',
  'deepinfra',
  'deepseek',
  'doubao',
  'featherless',
  'fireworks',
  'gemini',
  'giteeai',
  'github',
  'githubcopilot',
  'google',
  'grok',
  'groq',
  'huggingface',
  'hunyuan',
  'hyperbolic',
  'iflytekcloud',
  'infinigence',
  'internlm',
  'jina',
  'kimi',
  'kluster',
  'ling',
  'lmstudio',
  'meta',
  'minimax',
  'mistral',
  'modelscope',
  'moonshot',
  'nebius',
  'novita',
  'nvidia',
  'ollama',
  'openai',
  'opencode',
  'openrouter',
  'parasail',
  'perplexity',
  'poe',
  'ppio',
  'qwen',
  'replicate',
  'sambanova',
  'sensenova',
  'siliconcloud',
  'spark',
  'stepfun',
  'tencent',
  'together',
  'upstage',
  'vercel',
  'vertexai',
  'vllm',
  'volcengine',
  'voyage',
  'wenxin',
  'xai',
  'xiaomimimo',
  'yi',
  'zai',
  'zeroone',
  'zhipu',
] as const

export type ProviderIconId = (typeof PROVIDER_ICON_IDS)[number]

const ICON_SET = new Set<string>(PROVIDER_ICON_IDS)

const EXACT_ALIASES: Record<string, ProviderIconId> = {
  deepseekaccount: 'deepseek',
  deepseekofficial: 'deepseek',
  openaicodex: 'openai',
  amazonbedrock: 'bedrock',
  awsbedrock: 'bedrock',
  googlevertex: 'vertexai',
  googlegemini: 'gemini',
  azureopenai: 'azureai',
  cloudflareai: 'cloudflare',
  cloudflareaigateway: 'cloudflare',
  cloudflareworkersai: 'cloudflare',
  kimicoding: 'kimi',
  minimaxcn: 'minimax',
  moonshotai: 'moonshot',
  moonshotaicn: 'moonshot',
  opencodego: 'opencode',
  qwentokenplan: 'qwen',
  qwentokenplancn: 'qwen',
  qwentokenplanindividual: 'qwen',
  qwenportal: 'qwen',
  tongyi: 'qwen',
  tongyiqianwen: 'qwen',
  dashscope: 'qwen',
  vercelaigateway: 'vercel',
  xiaomi: 'xiaomimimo',
  xiaomitokenplanams: 'xiaomimimo',
  xiaomitokenplancn: 'xiaomimimo',
  xiaomitokenplansgp: 'xiaomimimo',
  mimo: 'xiaomimimo',
  antling: 'ling',
  zaicodingcn: 'zai',
  siliconflow: 'siliconcloud',
  aliyun: 'alibabacloud',
  alibaba: 'alibabacloud',
  bigmodel: 'zhipu',
  zhipuai: 'zhipu',
  glm: 'chatglm',
  ark: 'volcengine',
  volces: 'volcengine',
  volc: 'volcengine',
  bytedance: 'volcengine',
  '01ai': 'yi',
  lingyiwanwu: 'yi',
  ernie: 'wenxin',
  yiyan: 'wenxin',
  qianfan: 'baiducloud',
  baidu: 'baiducloud',
  xfyun: 'spark',
  iflytek: 'spark',
  '302ai': 'ai302',
  infini: 'infinigence',
  infiniai: 'infinigence',
  pplx: 'perplexity',
  hf: 'huggingface',
  amazon: 'aws',
  togetherai: 'together',
  fireworksai: 'fireworks',
  nvidianim: 'nvidia',
  tencentcloud: 'tencent',
  gitee: 'giteeai',
}

const PAIR_TOKENS: Record<string, ProviderIconId> = {
  'github+copilot': 'githubcopilot',
  'google+vertex': 'vertexai',
  'google+gemini': 'gemini',
  'azure+ai': 'azureai',
  'azure+openai': 'azureai',
  'ant+ling': 'ling',
  '01+ai': 'yi',
  'hugging+face': 'huggingface',
  'lm+studio': 'lmstudio',
  'amazon+bedrock': 'bedrock',
  'aws+bedrock': 'bedrock',
  'iflytek+cloud': 'iflytekcloud',
  '302+ai': 'ai302',
  'infini+ai': 'infinigence',
  'silicon+flow': 'siliconcloud',
  'silicon+cloud': 'siliconcloud',
}

const TOKEN_ALIASES: Record<string, ProviderIconId> = {
  alibaba: 'alibabacloud',
  aliyun: 'alibabacloud',
  baidu: 'baiducloud',
  dashscope: 'qwen',
  ernie: 'wenxin',
  glm: 'chatglm',
  iflytek: 'spark',
  mimo: 'xiaomimimo',
  moonshotai: 'moonshot',
  qianfan: 'baiducloud',
  siliconflow: 'siliconcloud',
  tongyi: 'qwen',
  vertex: 'vertexai',
  xiaomi: 'xiaomimimo',
  zhipuai: 'zhipu',
}

const CHINESE_BRANDS: readonly [string, ProviderIconId][] = [
  ['深度求索', 'deepseek'],
  ['月之暗面', 'moonshot'],
  ['通义', 'qwen'],
  ['千问', 'qwen'],
  ['百炼', 'bailian'],
  ['阿里云', 'alibabacloud'],
  ['阿里巴巴', 'alibabacloud'],
  ['智谱', 'zhipu'],
  ['百灵', 'ling'],
  ['蚂蚁', 'antgroup'],
  ['火山引擎', 'volcengine'],
  ['火山方舟', 'volcengine'],
  ['豆包', 'doubao'],
  ['硅基流动', 'siliconcloud'],
  ['百川', 'baichuan'],
  ['阶跃', 'stepfun'],
  ['零一万物', 'yi'],
  ['混元', 'hunyuan'],
  ['腾讯', 'tencent'],
  ['文心', 'wenxin'],
  ['千帆', 'baiducloud'],
  ['百度', 'baiducloud'],
  ['星火', 'spark'],
  ['讯飞', 'iflytekcloud'],
  ['商汤', 'sensenova'],
  ['书生', 'internlm'],
  ['魔搭', 'modelscope'],
  ['无问芯穹', 'infinigence'],
  ['派欧', 'ppio'],
  ['小米', 'xiaomimimo'],
]

function matchCandidate(raw?: string): ProviderIconId | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined

  const lower = trimmed.toLowerCase()
  const compact = lower.replace(/[^a-z0-9]+/g, '')
  if (compact) {
    if (ICON_SET.has(compact)) return compact as ProviderIconId
    if (Object.hasOwn(EXACT_ALIASES, compact)) return EXACT_ALIASES[compact]

    const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
    for (let i = 0; i + 1 < tokens.length; i++) {
      const pair = `${tokens[i]}+${tokens[i + 1]}`
      if (Object.hasOwn(PAIR_TOKENS, pair)) return PAIR_TOKENS[pair]
    }
    for (const token of tokens) {
      if (ICON_SET.has(token)) return token as ProviderIconId
      if (Object.hasOwn(TOKEN_ALIASES, token)) return TOKEN_ALIASES[token]
    }
  }

  for (const [keyword, icon] of CHINESE_BRANDS) {
    if (trimmed.includes(keyword)) return icon
  }

  return undefined
}

export function resolveProviderIconId(
  providerId?: string,
  providerName?: string,
): ProviderIconId | undefined {
  return matchCandidate(providerId) ?? matchCandidate(providerName)
}
