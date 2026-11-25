import React from "react";
import { Ui, joinNodes, renderInto } from "../react-runtime.jsx";
// 动态：把每一条变化翻译成一句人话。目标页、动态页、首页的“刚刚”都用这里的写法。
import { get } from "../api.js";
import { store, goal as getGoal, person, ancestors } from "../store.js";
import { esc, icon, avatar, num, pct, relTime, dayLabel, localDate, avatarStack, shortDate } from "../ui.jsx";
export async function feedSeed() {
  try {
    const {
      items
    } = await get('/api/events?limit=60');
    const known = new Set(store.feed.map(e => e.seq));
    store.feed = [...store.feed, ...items.filter(e => !known.has(e.seq))].sort((a, b) => b.seq - a.seq).slice(0, 300);
    store.feedSeeded = true;
  } catch {/* 动态稍后会随实时更新补上 */}
}
const goalLink = (e, text) => e.goalId && getGoal(e.goalId) ? <Ui as="a" href={`#/g/${esc(e.goalId)}`} className={"glink"}>{text}</Ui> : <Ui as="span" className={"glink gone"}>{text}</Ui>;
function fieldName(key) {
  return {
    title: '名称',
    target: '目标值',
    unit: '单位',
    startDate: '开始日期',
    endDate: '结束日期',
    ownerId: '负责人',
    kind: '类型',
    alignId: '挂靠',
    memberIds: '协作者'
  }[key] || key;
}
function changeText(key, [from, to], unit) {
  if (key === 'target') return <>{"目标值 "}{num(from)}{" → "}<Ui as="b">{num(to)}</Ui>{" "}{esc(unit || '')}</>;
  if (key === 'ownerId') return <>{"负责人 "}{esc(person(from).name)}{" → "}<Ui as="b">{esc(person(to).name)}</Ui></>;
  if (key === 'memberIds') {
    const added = to.filter(id => !from.includes(id)),
      removed = from.filter(id => !to.includes(id));
    return joinNodes([added.length ? <>{"邀请了 "}{joinNodes(added.map(id => esc(person(id).name)), '、')}</> : '', removed.length ? <>{"移除了 "}{joinNodes(removed.map(id => esc(person(id).name)), '、')}</> : ''].filter(Boolean), '，') || '调整了协作者';
  }
  if (key === 'endDate' || key === 'startDate') return `${fieldName(key)}改为 ${shortDate(to)}`;
  if (key === 'title') return `改名为「${esc(to)}」`;
  if (key === 'alignId') return to ? `挂靠到「${esc(getGoal(to)?.title || '组织目标')}」` : '取消了挂靠';
  return `调整了${fieldName(key)}`;
}

// 返回 { text, extra, tone, icon }
export function describe(e) {
  const d = e.data || {};
  const actor = <Ui as="b">{esc(person(e.actorId).name)}</Ui>;
  const title = goalLink(e, `「${esc(d.title || getGoal(e.goalId)?.title || '目标')}」`);
  switch (e.type) {
    case 'checkin.created':
      {
        if (d.comment) return {
          icon: 'message-circle',
          tone: 'talk',
          text: <>{actor}{" 在 "}{title}{" 说"}</>,
          quote: d.note
        };
        const parts = [];
        if (d.value !== null && d.value !== undefined) parts.push(<><Ui as="b" className={"plus"}>{d.value >= 0 ? '+' : ''}{num(d.value)}</Ui>{" "}{esc(d.unit || '')}</>);
        const tail = d.completion !== null && d.completion !== undefined && d.value !== null ? `累计 ${num(d.total)} / ${num(d.target)}，完成 ${pct(d.completion)}` : '';
        const sig = d.signal === 'help' ? 'help' : d.signal === 'watch' ? 'watch' : d.signal === 'ok' ? 'ok' : null;
        return {
          icon: sig === 'help' ? 'life-buoy' : 'trending-up',
          tone: d.voided ? 'muted' : sig === 'help' ? 'help' : sig === 'watch' ? 'watch' : 'progress',
          text: <>{actor}{" "}{parts.length ? <>{"给 "}{title}{" 记了 "}{joinNodes(parts, '')}</> : <>{"更新了 "}{title}{" 的状态"}</>}</>,
          sub: tail,
          quote: d.note,
          signal: sig,
          voided: d.voided
        };
      }
    case 'goal.created':
      {
        const owners = d.ownerIds || [];
        const owner = owners[0];
        const where = d.parentTitle ? `，挂在「${esc(d.parentTitle)}」下面` : d.scope === 'personal' ? '（自主目标）' : d.scope === 'company' ? '（公司目标）' : '';
        return {
          icon: 'sparkles',
          tone: 'new',
          text: <>{actor}{" 新建了 "}{title}{where}</>,
          sub: joinNodes([d.kind === 'measure' && d.target !== null ? `目标 ${num(d.target)} ${esc(d.unit || '')}` : d.kind === 'action' ? '做完就行' : '', owner && owner !== e.actorId ? `由 ${esc(person(owner).name)} 负责` : ''].filter(Boolean), ' · '),
          people: owners
        };
      }
    case 'goal.split':
      return {
        icon: 'git-fork',
        tone: 'new',
        text: <>{actor}{" 把 "}{title}{" 拆给了 "}{d.count}{" 位成员"}</>,
        sub: d.total ? `共 ${num(d.total)} ${esc(d.unit || '')}` : '',
        people: d.ownerIds || []
      };
    case 'goal.updated':
      {
        const changes = Object.entries(d.changes || {}).slice(0, 3).map(([k, v]) => changeText(k, v, d.unit));
        return {
          icon: 'square-pen',
          tone: 'quiet',
          text: <>{actor}{" 调整了 "}{title}</>,
          sub: joinNodes(changes, '；')
        };
      }
    case 'goal.done':
      return {
        icon: 'circle-check',
        tone: 'done',
        text: <>{actor}{" 完成了 "}{title}</>,
        quote: d.note
      };
    case 'goal.achieved':
      return {
        icon: 'party-popper',
        tone: 'done',
        text: <>{title}{" 达成啦！"}</>,
        sub: <>{"累计 "}{num(d.total)}{" / "}{num(d.target)}{" "}{esc(d.unit || '')}{d.via ? `，最后一笔来自「${esc(d.via)}」` : ''}{" · "}{actor}{" 记下了这一笔"}</>,
        big: true
      };
    case 'goal.reopened':
      return {
        icon: 'rotate-ccw',
        tone: 'quiet',
        text: <>{actor}{" 重新打开了 "}{title}</>
      };
    case 'goal.archived':
      return {
        icon: 'archive',
        tone: 'quiet',
        text: <>{actor}{" 归档了 "}{title}{d.count > 1 ? `（含 ${d.count - 1} 项拆解）` : ''}</>
      };
    case 'goal.restored':
      return {
        icon: 'undo-2',
        tone: 'quiet',
        text: <>{actor}{" 恢复了 "}{title}</>
      };
    case 'member.joined':
      return {
        icon: 'hand-heart',
        tone: 'new',
        text: <>{actor}{" 加入了 "}{title}{" 的协作"}</>
      };
    default:
      return {
        icon: 'dot',
        tone: 'quiet',
        text: <>{actor}{" 更新了 "}{title}</>
      };
  }
}
function pathOf(goalId) {
  const g = getGoal(goalId);
  if (!g) return '';
  const chain = ancestors(g);
  if (!chain.length) return g.scope === 'personal' ? '自主目标' : '';
  const root = chain[0];
  return chain.length > 1 ? `${esc(root.title)} › … › ${esc(chain[chain.length - 1].title)}` : esc(root.title);
}
export function eventItem(e, {
  compact = false,
  showPath = true,
  canComment = true
} = {}) {
  const info = describe(e);
  const fresh = e.fresh && Date.now() - e.fresh < 8000;
  const path = showPath ? pathOf(e.goalId) : '';
  const cs = store.cheers.get(e.seq);
  const cheers = cs?.count ?? e.cheers,
    cheered = cs?.cheered ?? e.cheered;
  return <Ui as="li" className={`ev tone-${info.tone}${fresh ? ' fresh' : ''}${info.big ? ' big' : ''}${info.voided ? ' voided' : ''}`} data-key={`ev-${e.seq}`} key={`ev-${e.seq}`}>{"\n    "}<Ui as="div" className={"ev-av"}>{avatar(e.actorId, 'sm')}<Ui as="i" className={"ev-ic"}>{icon(info.icon)}</Ui></Ui>{"\n    "}<Ui as="div" className={"ev-body"}>{"\n      "}<Ui as="p" className={"ev-text"}>{info.text}{info.voided ? <>{" "}<Ui as="small" className={"muted"}>{"（已撤回）"}</Ui></> : ''}</Ui>{"\n      "}{info.sub ? <Ui as="p" className={"ev-sub"}>{info.sub}</Ui> : ''}{"\n      "}{info.quote ? <Ui as="blockquote">{esc(info.quote)}</Ui> : ''}{"\n      "}{info.signal === 'help' ? <Ui as="span" className={"chip tone-help sm"}>{icon('life-buoy')}{"需要支持"}</Ui> : info.signal === 'watch' ? <Ui as="span" className={"chip tone-watch sm"}>{icon('hourglass')}{"有点担心"}</Ui> : ''}{"\n      "}{info.people?.length > 1 ? <Ui as="div" className={"ev-people"}>{avatarStack(info.people, 6)}</Ui> : ''}{"\n      "}<Ui as="div" className={"ev-meta"}><Ui as="time" datetime={esc(e.at)} title={esc(e.at.replace('T', ' ').slice(0, 16))}>{relTime(e.at)}</Ui>{path && !compact ? <Ui as="span" className={"ev-path"}>{path}</Ui> : ''}{e.data?.simulated ? <Ui as="span" className={"sim"}>{"演示"}</Ui> : ''}{"\n        "}<Ui as="span" className={"grow"} />{"\n        "}{canComment && getGoal(e.goalId) && !compact ? <Ui as="button" type={"button"} className={"ev-btn"} data-act={"comment"} data-id={esc(e.goalId)} aria-label={"回复"}>{icon('message-circle')}<Ui as="span">{"回复"}</Ui></Ui> : ''}{"\n        "}<Ui as="button" type={"button"} className={`ev-btn cheer${cheered ? ' on' : ''}`} data-act={"cheer"} data-seq={e.seq} aria-label={"点赞"} aria-pressed={Boolean(cheered)}>{icon('heart')}<Ui as="span">{cheers || ''}</Ui></Ui>{"\n      "}</Ui>{"\n    "}</Ui></Ui>;
}
export function grouped(events, options) {
  const groups = [];
  for (const event of events) {
    const day = localDate(event.at);
    if (groups.at(-1)?.day !== day) groups.push({day, at: event.at, items: []});
    groups.at(-1).items.push(event);
  }
  return groups.map(group => <React.Fragment key={group.day}><Ui as="h4" className="day" data-key={`day-${group.day}`}>{dayLabel(group.at)}</Ui><Ui as="ul" className="timeline" data-key={`tl-${group.day}`}>{group.items.map(event => eventItem(event, options))}</Ui></React.Fragment>);
}

// 一句话的“刚刚”滚动条
export function ticker(limit = 1) {
  const list = store.feed.filter(e => e.type !== 'goal.updated').slice(0, limit);
  if (!list.length) return '';
  return joinNodes(list.map(e => {
    const info = describe(e);
    return <Ui as="div" className={`ticker-item${e.fresh && Date.now() - e.fresh < 8000 ? ' fresh' : ''}`} data-key={`tk-${e.seq}`} key={`tk-${e.seq}`}>{avatar(e.actorId, 'xs')}<Ui as="span" className={"ticker-text"}>{info.text}{info.quote ? `：${esc(info.quote.length > 40 ? info.quote.slice(0, 40) + '…' : info.quote)}` : info.sub && e.type === 'checkin.created' ? ` · ${info.sub}` : ''}</Ui><Ui as="time">{relTime(e.at)}</Ui></Ui>;
  }), '');
}

// 你不在的时候发生了什么
export function awaySummary() {
  if (!store.lastSeenSeq || !store.feedSeeded) return null;
  const list = store.feed.filter(e => e.seq > store.lastSeenSeq && e.actorId !== store.me.id && !e.fresh);
  if (!list.length) return null;
  const count = type => list.filter(e => e.type === type).length;
  const helps = list.filter(e => e.type === 'checkin.created' && e.data?.signal === 'help');
  return {
    total: list.length,
    progress: list.filter(e => e.type === 'checkin.created' && !e.data?.comment).length,
    created: count('goal.created') + count('goal.split'),
    achieved: count('goal.achieved') + count('goal.done'),
    help: helps.length,
    comments: list.filter(e => e.type === 'checkin.created' && e.data?.comment).length,
    people: new Set(list.map(e => e.actorId)).size,
    top: list.slice(0, 3),
    since: store.lastSeenAt,
    more: list.length >= 60
  };
}
