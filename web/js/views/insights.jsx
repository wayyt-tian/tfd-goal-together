import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 锅气小助手：不打分、不排名，只用几条简单规则把“现在最值得看一眼的事”说成人话。
import { store, person, children, isAdmin, isLead, teamSet } from "../store.js";
import { esc, num, pct, daysSince, shortDate } from "../ui.jsx";
function scopeGoals() {
  const all = [...store.goals.values()];
  if (isAdmin()) return {
    list: all,
    who: '公司'
  };
  if (isLead()) {
    const team = teamSet();
    const ids = new Set([store.me.id, ...team]);
    return {
      list: all.filter(g => ids.has(g.ownerId) || g.memberIds.some(id => ids.has(id))),
      who: '团队'
    };
  }
  return {
    list: all.filter(g => g.ownerId === store.me.id || g.memberIds.includes(store.me.id)),
    who: '你'
  };
}
const names = (ids, max = 2) => {
  const list = [...new Set(ids)].map(id => esc(person(id).name));
  return list.length > max ? `${list.slice(0, max).join('、')} 等 ${list.length} 人` : list.join('、');
};
export function insights({
  limit = 5
} = {}) {
  const {
    list,
    who
  } = scopeGoals();
  const active = list.filter(g => g.stat && !['done', 'upcoming'].includes(g.stat.status));
  const leaves = active.filter(g => !g.stat.childCount);
  const out = [];

  // 1. 节奏总览
  const roots = [...store.goals.values()].filter(g => !g.parentId && g.scope === 'company' && g.stat);
  if ((isAdmin() || isLead()) && roots.length) {
    const running = roots.filter(r => r.stat.status !== 'upcoming');
    const c = st => roots.filter(r => r.stat.status === st).length;
    const parts = joinNodes([['ok', '顺利'], ['watch', '稍慢'], ['risk', '落后'], ['neutral', '在推进'], ['done', '已达成'], ['upcoming', '还没开始']].map(([k, l]) => c(k) ? `${c(k)} 个${l}` : '').filter(Boolean), '、');
    const scopeText = isAdmin() ? `公司的 ${roots.length} 个目标` : `你能看到的 ${roots.length} 个公司目标`;
    if (!running.length) {
      const first = roots.map(r => r.startDate).sort()[0];
      out.push({
        tone: 'info',
        icon: 'sunrise',
        text: <>{scopeText}{"都从 "}<Ui as="b">{esc(shortDate(first))}</Ui>{" 开始，现在正好把拆解路径和份额理顺，开跑那天大家就能直接记进展。"}</>,
        href: '#/map',
        cta: '看地图'
      });
    } else {
      const tp = Math.max(...running.map(r => r.stat.timeProgress));
      out.push({
        tone: 'info',
        icon: 'compass',
        text: <>{"时间过去了 "}<Ui as="b">{pct(tp)}</Ui>{"，"}{scopeText}{"里 "}{parts}{"。"}</>,
        href: '#/map',
        cta: '看地图'
      });
    }
  } else if (!isLead()) {
    const mine = list.filter(g => g.stat);
    if (mine.length) {
      const c = st => mine.filter(g => g.stat.status === st).length;
      out.push({
        tone: 'info',
        icon: 'compass',
        text: `你关联的 ${mine.length} 个目标里，${c('ok') + c('done')} 个顺利或已达成${c('watch') ? `，${c('watch')} 个稍慢` : ''}${c('risk') ? `，${c('risk')} 个落后` : ''}。`,
        href: '#/',
        cta: '回到我的'
      });
    }
  }
  // 2. 需要支持
  const help = active.filter(g => g.stat.signal === 'help');
  if (help.length) out.push({
    tone: 'help',
    icon: 'life-buoy',
    text: `${names(help.map(g => g.ownerId))} 在 ${help.length} 个目标上点了“需要支持”，比如「${esc(help[0].title)}」，回一句就能帮上忙。`,
    href: '#/pulse?filter=help',
    cta: '去看看'
  });
  // 3. 离节奏最远的
  const behind = active.filter(g => g.stat.deviation !== null && g.stat.status === 'risk').sort((a, b) => a.stat.deviation - b.stat.deviation);
  if (behind.length) {
    const g = behind.find(x => x.stat.childCount) || behind[0];
    const worstKid = children(g.id).filter(c => c.stat && c.stat.deviation !== null).sort((a, b) => a.stat.deviation - b.stat.deviation)[0];
    out.push({
      tone: 'risk',
      icon: 'triangle-alert',
      text: `「${esc(g.title)}」离节奏最远，慢了 ${Math.round(-g.stat.deviation * 100)} 个点${worstKid && worstKid.stat.status !== 'ok' ? `，主要在「${esc(worstKid.title)}」` : ''}。先看看拆解路径，一起想办法。`,
      href: '#/g/' + encodeURIComponent(g.id),
      cta: '下探'
    });
  }
  // 4. 很久没更新
  const stale = leaves.filter(g => g.stat.stale);
  if (stale.length) out.push({
    tone: 'quiet',
    icon: 'clock',
    text: `${stale.length} 项超过 ${store.settings.staleDays} 天没更新（${names(stale.map(g => g.ownerId))}），提醒一句，进展就能回到地图上。`,
    href: isLead() ? '#/team?filter=stale' : '#/',
    cta: isLead() ? '看是谁' : '去记一笔'
  });
  // 5. 没分出去的份额
  const gap = active.filter(g => g.kind === 'measure' && g.stat.childCount && g.stat.gap > 1e-6 && (g.ownerId === store.me.id || isAdmin())).sort((a, b) => b.stat.gap / (b.target || 1) - a.stat.gap / (a.target || 1));
  if (gap.length) out.push({
    tone: 'info',
    icon: 'git-fork',
    text: `「${esc(gap[0].title)}」还有 ${num(gap[0].stat.gap)} ${esc(gap[0].unit)} 没拆到具体的人，可以拆给成员，或者加一条新的关键路径。`,
    href: '#/g/' + encodeURIComponent(gap[0].id),
    cta: '去拆解'
  });
  // 6. 快到期的关键动作
  const due = leaves.filter(g => g.kind === 'action' && !g.doneAt && g.stat.daysLeft <= 3 && g.stat.status !== 'risk');
  if (due.length) out.push({
    tone: 'watch',
    icon: 'hourglass',
    text: `${due.length} 个关键动作 3 天内到期，比如「${esc(due[0].title)}」。`,
    href: '#/g/' + encodeURIComponent(due[0].id),
    cta: '看看'
  });
  // 7. 跑在前面的
  const ahead = leaves.filter(g => g.stat.deviation !== null && g.stat.deviation >= 0.1).sort((a, b) => b.stat.deviation - a.stat.deviation);
  if (ahead.length) out.push({
    tone: 'ok',
    icon: 'rocket',
    text: `${ahead.length} 项跑在时间前面，比如 ${esc(person(ahead[0].ownerId).name)} 的「${esc(ahead[0].title)}」领先 ${Math.round(ahead[0].stat.deviation * 100)} 个点，去点个赞吧。`,
    href: '#/g/' + encodeURIComponent(ahead[0].id),
    cta: '看看'
  });
  // 8. 新想法
  const week = store.feed.filter(e => e.type === 'goal.created' && daysSince(e.at.slice(0, 10)) <= 6);
  if (week.length) {
    const personal = week.filter(e => e.data?.scope === 'personal').length;
    out.push({
      tone: 'new',
      icon: 'sparkles',
      text: `这周大家新建了 ${week.length} 个目标${personal ? `，其中 ${personal} 个是自主发起的` : ''}，${who === '你' ? '有好点子也可以随手建一个' : '好点子正在长出来'}。`,
      href: '#/pulse?filter=new',
      cta: '看新目标'
    });
  }
  if (!out.length) out.push({
    tone: 'ok',
    icon: 'sun',
    text: '一切平稳。想到新的增长点子，随时点“新建”。'
  });
  return out.slice(0, limit);
}
export function assistantCard({
  limit = 4,
  compact = false
} = {}) {
  const items = insights({
    limit
  });
  return <Ui as="section" className={`assistant${compact ? ' compact' : ''}`} data-key={"assistant"} key={"assistant"}>{"\n    "}<Ui as="img" src={"/assets/brand/ip-think.webp"} alt={""} width={"96"} height={"74"} loading={"lazy"} />{"\n    "}<Ui as="div" className={"assistant-body"}><Ui as="h2">{"锅气小助手"}<Ui as="small">{"根据实时进展自动整理"}</Ui></Ui>{"\n      "}<Ui as="ul">{joinNodes(items.map((item, i) => <Ui as="li" className={`tone-${item.tone}`} data-key={`in-${i}-${item.icon}`} key={`in-${i}-${item.icon}`}><Ui as="i" className={"pip"} /><Ui as="span">{item.text}</Ui>{item.href ? <Ui as="a" href={item.href} className={"link"}>{item.cta || '看看'}</Ui> : ''}</Ui>), '')}</Ui>{"\n    "}</Ui></Ui>;
}
