export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  const { type, text, image, mediaType } = await req.json();

  const systemContent = `你是陈氏医疗顾问的AI助手，定位是"就医助手"，不是诊断工具。

你的核心任务是：
1. 帮患者用大白话看懂报告说了什么
2. 帮患者准备好去见医生时该问的问题
3. 给出就医方向建议，但不做最终诊断

语气要求：
- 用"可能""提示""需要医生确认"等措辞，不要用肯定性诊断语气
- 温和、不引起恐慌，但不回避重要发现
- 像一个有医学背景的朋友，帮你看报告、陪你去问医生

请自动判断文件类型，严格以JSON格式返回：
{
  "report_type": "报告类型",
  "urgency": "一句话就医建议，例如：'建议近期到妇科复查' / '建议1个月内就诊' / '建议尽快就医' / '定期复查即可'",
  "urgency_level": "low/medium/high",
  "summary": "用大白话说这份报告的主要发现，语气像朋友解释，不夸大不缩小",
  "findings": [
    "【发现】具体数值或描述 → 【可能意味着】用大白话解释，加'需要医生进一步确认' → 【建议】下一步怎么做"
  ],
  "medications": ["药物名：这个药是做什么的、怎么吃、注意什么"],
  "questions": ["去看医生时，可以这样问：'医生，XXX是什么意思？需要治疗吗？'"],
  "next_steps": "建议看什么科、做什么检查、多久复查一次"
}

重要原则：
- findings 里每条都要有"需要医生进一步确认"或类似措辞
- questions 要具体，帮患者直接说出口
- 所有数值保留，注明参考范围
- 如果不是处方/用药文件，medications 返回空数组 []
- 只返回JSON，不要任何其他内容`;

  try {
    let reportText = text;

    if (type === 'image') {
      if (!openaiKey) {
        return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), { status: 500 });
      }

      const ocrResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: '你是一个医疗文件OCR助手。请完整提取图片中所有文字内容，保持原有格式和结构，不要遗漏任何数值、单位、专业术语。只输出提取的文字，不要添加任何解释或评论。'
            },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: `data:${mediaType};base64,${image}`, detail: 'high' }
                },
                { type: 'text', text: '请提取这张医疗文件图片中的所有文字内容。' }
              ]
            }
          ],
          max_tokens: 2000,
          temperature: 0
        })
      });

      const ocrData = await ocrResponse.json();
      if (!ocrResponse.ok) {
        return new Response(JSON.stringify({ error: ocrData.error?.message || 'OCR失败' }), { status: 500 });
      }
      reportText = ocrData.choices[0].message.content;
    }

    if (!deepseekKey) {
      return new Response(JSON.stringify({ error: 'DeepSeek API key not configured' }), { status: 500 });
    }

    const analyzeResponse = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${deepseekKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: `请分析以下医疗文件内容：\n\n${reportText}` }
        ],
        max_tokens: 1500,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });

    const analyzeData = await analyzeResponse.json();
    if (!analyzeResponse.ok) {
      return new Response(JSON.stringify({ error: analyzeData.error?.message || 'DeepSeek请求失败' }), { status: 500 });
    }

    const resultText = analyzeData.choices[0].message.content.replace(/```json|```/g, '').trim();
    const result = JSON.parse(resultText);

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
