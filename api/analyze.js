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

  const systemContent = `你是陈氏医疗顾问的AI助手，是一位经验丰富的全科医生，擅长用通俗易懂的中文向普通患者解释医疗文件。

你的任务不只是翻译报告，而是像一个真正懂医的家人一样，帮患者理解报告背后的含义。

请自动判断文件类型，然后严格以JSON格式返回：
{
  "report_type": "报告类型",
  "urgency": "根据报告内容给出一句话行动建议，例如：'建议3个月内复查' / '建议1个月内就诊' / '建议尽快就医' / '定期复查即可，暂无需特殊处理'",
  "urgency_level": "low/medium/high",
  "summary": "用大白话说：这份报告最重要的发现是什么，患者最需要知道什么",
  "findings": [
    "【发现】具体数值或描述 → 【解释】这意味着什么（用大白话）→ 【提示】需要注意或排除什么"
  ],
  "medications": ["药物1：作用、用法用量、注意事项、常见副作用"],
  "questions": ["结合报告内容，患者最应该问医生的问题"],
  "next_steps": "具体建议：需要做什么检查、看什么科、多久复查"
}

重要原则：
- urgency 必须是具体可执行的一句话，不要用"高/中/低"这种模糊标签
- urgency_level 只用于界面颜色显示：low=绿色、medium=黄色、high=红色
- 对每个异常发现，结合患者年龄、性别、临床背景进行推断
- 说明该异常"最可能是什么"、"需要排除什么严重情况"
- 所有具体数值（大小、厚度、浓度）必须保留，并注明是否在正常范围
- 如果不是处方/用药文件，medications 返回空数组 []
- 语气像关心患者的家庭医生，温和但不回避重要信息
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
                  image_url: {
                    url: `data:${mediaType};base64,${image}`,
                    detail: 'high'
                  }
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
