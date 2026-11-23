// src/evaluator.ts
export interface TurnTranscript {
  turn_index: number;
  examiner_prompt: string;
  candidate_text: string;
  duration_sec: number;
}

export interface GrammarIssue {
  original_fragment: string;
  correction: string;
  rule_explanation_zh: string;
  severity: 'MINOR' | 'MODERATE' | 'MAJOR';
}

export interface ExamEvaluationReport {
  overall_cefr: 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  nclc_estimated: number; // 4 to 10+
  tcf_score_estimated: string; // e.g., "14 / 20 (Niveau B2 - NCLC 8)"
  subscores: {
    fluency_and_coherence: number; // /20
    lexical_range: number; // /20
    grammar_accuracy: number; // /20
    task_fulfillment: number; // /20
  };
  stats: {
    total_words: number;
    speaking_rate_wpm: number;
    questions_asked_in_tache2: number;
    connectors_used: string[];
  };
  grammar_corrections: GrammarIssue[];
  upgraded_c1_expressions: Array<{ basic: string; advanced: string; context: string }>;
  examiner_feedback_zh: string;
  examiner_feedback_fr: string;
}

const DISCOURSE_CONNECTORS = [
  "d'abord", "ensuite", "enfin", "par ailleurs", "de plus", "en outre",
  "cependant", "pourtant", "néanmoins", "en revanche", "malgré",
  "par conséquent", "donc", "c'est pourquoi", "ainsi",
  "à mon avis", "selon moi", "je pense que", "il me semble que",
  "en conclusion", "pour conclure", "en résumé", "tout compte fait"
];

const FRENCH_GRAMMAR_PATTERNS: Array<{
  regex: RegExp;
  fix: (m: string) => string;
  explanation: string;
  severity: 'MINOR' | 'MODERATE' | 'MAJOR';
}> = [
  {
    regex: /\bje suis aller\b/gi,
    fix: () => 'je suis allé(e)',
    explanation: '复合过去时 (Passé composé) 中，aller 需用助动词 être，且过去分词为 allé(e)，不能用原形。',
    severity: 'MAJOR'
  },
  {
    regex: /\bj'ai allé\b/gi,
    fix: () => 'je suis allé(e)',
    explanation: '动词 aller 在复合过去时中必须搭配助动词 être（je suis allé），不能用 avoir。',
    severity: 'MAJOR'
  },
  {
    regex: /\bje veux que tu (vas|peux|fais|es|as)\b/gi,
    fix: (m) => m.replace(/vas/i, 'ailles').replace(/peux/i, 'puisses').replace(/fais/i, 'fasses').replace(/es/i, 'sois').replace(/as/i, 'aies'),
    explanation: '意愿动词 vouloir que 后面必须接虚拟式 (Subjonctif présent)，这是 TCF B2/C1 核心语法考点。',
    severity: 'MAJOR'
  },
  {
    regex: /\bil faut que je (vais|peux|fais|suis|ai)\b/gi,
    fix: (m) => m.replace(/vais/i, 'aille').replace(/peux/i, 'puisse').replace(/fais/i, 'fasse').replace(/suis/i, 'sois').replace(/ai/i, 'aie'),
    explanation: '无人称句 il faut que 后面必须接虚拟式 (Subjonctif)，例如 il faut que j’aille / que je fasse。',
    severity: 'MAJOR'
  },
  {
    regex: /\bsi j'aurais\b/gi,
    fix: () => "si j'avais",
    explanation: '条件句 Si 从句中绝对不能直接用条件式 (Conditionnel)，应使用未完成过去时 (Imparfait)：Si j’avais..., je ferais...',
    severity: 'MAJOR'
  },
  {
    regex: /\bdes bons\b|\bdes grands\b|\bdes petits\b|\bdes nouveaux\b/gi,
    fix: (m) => m.replace(/^des\s+/i, 'de '),
    explanation: '复数形容词位于复数名词前时，不定冠词 des 通常缩合为 de（如 de bons conseils, de grands avantages）。',
    severity: 'MINOR'
  },
  {
    regex: /\bparce que de\b/gi,
    fix: () => 'à cause de / grâce à',
    explanation: 'parce que 后面必须接完整句子；如果直接接名词，请改用 à cause de（消极原因）或 grâce à（积极原因）。',
    severity: 'MODERATE'
  },
  {
    regex: /\bje suis d'accord avec vous que\b/gi,
    fix: () => "je suis d'accord avec vous sur le fait que",
    explanation: 'être d’accord avec quelqu’un 不能直接接 que 从句，应说 sur le fait que 或直接说 je pense que。',
    severity: 'MODERATE'
  },
  {
    regex: /\bcombien de prix\b|\bquel est le prix de coût\b/gi,
    fix: () => 'quel est le tarif / combien ça coûte',
    explanation: '在 Tâche 2 询问价格时，地道法语表达为 « Quel est le tarif ? » 或 « Combien cela coûte-t-il ? »。',
    severity: 'MINOR'
  }
];

/**
 */
export function generateExaminerReply(params: {
  role: string;
  topicPrompt: string;
  keywords: string[];
  turnIndex: number;
  candidateText: string;
}): { reply_fr: string; hint_zh: string; is_tache_complete: boolean } {
  const text = params.candidateText.trim();
  const hasQuestionMark = text.includes('?') || /^(est-ce que|quel|quelle|quels|quelles|combien|quand|où|comment|pourquoi|pouvez-vous|pourriez-vous|avez-vous|y a-t-il)/i.test(text);

  if (params.tache === 'tache2') {
    const remaining = params.keywords.filter((kw) => !text.toLowerCase().includes(kw.toLowerCase()));
    if (!hasQuestionMark && text.length > 5) {
      return {
        reply_fr: "D’accord, je comprends votre intérêt. Mais n’oubliez pas que c’est à vous de me poser des questions pour obtenir des renseignements ! Que souhaitez-vous savoir exactement ?",
        hint_zh: "⚠️ 考官提醒：Tâche 2 需要由你主动向考官发问（使用 Est-ce que / Quel / Combien / Comment 等疑问句）。",
        is_tache_complete: false
      };
    }

    if (params.turnIndex >= 4) {
      return {
        reply_fr: "Vous avez toutes les informations nécessaires maintenant. Merci pour vos questions très précises. Passons maintenant à la dernière partie, la Tâche 3.",
        hint_zh: "Tâche 2 互动充分！请点击「下一步」进入 Tâche 3 观点辩论环节。",
        is_tache_complete: true
      };
    }

    const nextAngle = remaining[0] || 'les modalités pratiques';
    const roleResponses: string[] = [
      `Bien sûr ! En ce qui concerne ce point, tout est très flexible et adapté à votre budget. Avez-vous d'autres questions, par exemple sur ${nextAngle} ?`,
      `C'est une excellente question. Généralement, les tarifs sont très raisonnables et il y a des réductions si vous réservez à l'avance. Souhaitez-vous savoir autre chose concernant ${nextAngle} ?`,
      `Oui, tout à fait, c'est possible du lundi au samedi. Je vous conseille de vérifier les conditions en ligne également. Quelle autre information vous serait utile ?`
    ];

    return {
      reply_fr: roleResponses[params.turnIndex % roleResponses.length],
      hint_zh: `💡 考官已回答你的问题。建议继续追问方向：${remaining.slice(0, 3).join(' / ') || '具体预约方式与优惠条件'}（已问 ${params.turnIndex + 1} 轮，建议问够 4-5 轮）。`,
      is_tache_complete: false
    };
  }

  // Tâche 3: Debate / Counter-argument pushback
  if (params.turnIndex === 0) {
    return {
      reply_fr: "Votre point de vue est intéressant et bien structuré. Cependant, certaines personnes pensent exactement le contraire et soulignent les risques ou les limites de cette idée. Comment répondez-vous à ces critiques ?",
      hint_zh: "🔥 考官反驳追问（Tâche 3 核心）：考官提出了对立观点，请用 « Certes... mais / En revanche / Il n'en reste pas moins que... » 进行让步反驳并举例！",
      is_tache_complete: false
    };
  }

  return {
    reply_fr: "Je vous remercie pour cet échange très riche. L’épreuve d’expression orale est maintenant terminée. Vous pouvez consulter votre bilan détaillé.",
    hint_zh: "🎉 全真模拟考试结束！点击「结束考试并生成分析报告」查看你的 NCLC 预估等级与逐句语法纠错。",
    is_tache_complete: true
  };
}

/**
 * Evaluates full exam transcript locally (plus optional LLM API enhancement if user provides key)
 */
export function evaluateExamLocally(turns: TurnTranscript[]): ExamEvaluationReport {
  const allText = turns.map((t) => t.candidate_text).join(' ').trim();
  const words = allText ? allText.split(/\s+/).filter(Boolean) : [];
  const totalWords = words.length;
  const totalSec = Math.max(10, turns.reduce((s, t) => s + (t.duration_sec || 15), 0));
  const wpm = Math.round((totalWords / totalSec) * 60);

  const lowerText = allText.toLowerCase();
  const usedConnectors = DISCOURSE_CONNECTORS.filter((c) => lowerText.includes(c));

  const t2Turns = turns.filter((t) => t.tache === 'tache2');
  const questionsAsked = t2Turns.filter(
    (t) => t.candidate_text.includes('?') || /\b(est-ce que|quel|quelle|combien|comment|où|quand|pourquoi|pouvez|pourriez)\b/i.test(t.candidate_text)
  ).length;

  const grammarIssues: GrammarIssue[] = [];
  for (const turn of turns) {
    for (const rule of FRENCH_GRAMMAR_PATTERNS) {
      const matches = turn.candidate_text.match(rule.regex);
      if (matches) {
        for (const m of matches) {
          grammarIssues.push({
            original_fragment: m,
            correction: rule.fix(m),
            rule_explanation_zh: rule.explanation,
            severity: rule.severity
          });
        }
      }
    }
  }

  // Score calculation (out of 20)
  const fluency = Math.min(19, Math.max(6, Math.round(8 + Math.min(totalWords / 35, 7) + Math.min(wpm / 25, 4))));
  const lexical = Math.min(19, Math.max(6, Math.round(7 + usedConnectors.length * 1.4 + (totalWords > 180 ? 3 : 1))));
  const grammarPenalty = grammarIssues.reduce((acc, g) => acc + (g.severity === 'MAJOR' ? 2 : 1), 0);
  const grammar = Math.min(19, Math.max(5, 16 - grammarPenalty));
  const taskFulfillment = Math.min(19, Math.max(6, Math.round(8 + Math.min(questionsAsked * 2, 6) + (turns.length >= 5 ? 4 : 2))));

  const avgScore = Number(((fluency + lexical + grammar + taskFulfillment) / 4).toFixed(1));

  let cefr: ExamEvaluationReport['overall_cefr'] = 'B1';
  let nclc = 6;
  if (avgScore >= 16) { cefr = 'C1'; nclc = 10; }
  else if (avgScore >= 14) { cefr = 'B2'; nclc = 9; }
  else if (avgScore >= 12) { cefr = 'B2'; nclc = 7; }
  else if (avgScore >= 9) { cefr = 'B1'; nclc = 6; }
  else { cefr = 'A2'; nclc = 4; }

  return {
    overall_cefr: cefr,
    nclc_estimated: nclc,
    tcf_score_estimated: `${avgScore} / 20 (Niveau ${cefr} — NCLC ${nclc})`,
    subscores: {
      fluency_and_coherence: fluency,
      lexical_range: lexical,
      grammar_accuracy: grammar,
      task_fulfillment: taskFulfillment
    },
    stats: {
      total_words: totalWords,
      speaking_rate_wpm: wpm,
      questions_asked_in_tache2: questionsAsked,
      connectors_used: usedConnectors
    },
    grammar_corrections: grammarIssues.length > 0 ? grammarIssues : [
      {
        original_fragment: '(整体句法稳定)',
        correction: '可在 Tâche 3 中主动加入虚拟式（ex: Bien que cela soit utile...）与条件式（Il faudrait que...）以冲击 C1/NCLC 10 高分。',
        rule_explanation_zh: '未检测到严重基础时态/搭配错误。冲刺加拿大联邦 EE 加分（NCLC 7+ / NCLC 9+）建议增加高级连接词与虚拟式句型。',
        severity: 'MINOR'
      }
    ],
    upgraded_c1_expressions: [
      {
        basic: 'Je pense que c’est bien / important.',
        advanced: 'Il me semble primordial de souligner que... / Force est de constater que...',
        context: 'Tâche 3 开头亮明立场时替换基础句型'
      },
      {
        basic: 'Combien ça coûte ?',
        advanced: 'Pourriez-vous me préciser les tarifs en vigueur ainsi que les éventuelles réductions ?',
        context: 'Tâche 2 礼貌得体询问价格（使用条件式礼貌请求）'
      },
      {
        basic: 'Mais il y a aussi des problèmes.',
        advanced: 'Il n’en demeure pas moins que cette évolution soulève certaines limites, notamment...',
        context: 'Tâche 3 引入反方论点（Contre）的高级转折'
      }
    ],
    examiner_feedback_zh: `本次模拟共完成 ${turns.length} 轮有效对话，总词数 ${totalWords} 词，平均语速 ${wpm} 词/分钟。Tâche 2 中识别出 ${questionsAsked} 个有效疑问句，逻辑连接词使用 ${usedConnectors.length} 个。当前预估水平为 ${cefr}（对应加拿大移民语言标准 NCLC ${nclc}）。`,
    examiner_feedback_fr: `Candidat(e) capable de maintenir l'interaction avec une aisance satisfaisante (${totalWords} mots produits). L'utilisation des connecteurs logiques (${usedConnectors.length} repérés) structure bien le discours. Niveau global estimé : ${cefr} (NCLC ${nclc}).`
  };
}
