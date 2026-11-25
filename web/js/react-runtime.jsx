import React, { useState, useRef, useLayoutEffect, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';

// 兼容视图的刷新接口；元素和子节点都由 React 创建、协调和清理。
const slots = new WeakMap();
const roots = new WeakMap();
let dispatch = () => {};
export function setActionDispatcher(fn) { dispatch = fn; }
export function joinNodes(items, separator = ',') {
  if (!items.some(item => React.isValidElement(item) || Array.isArray(item))) return items.join(separator);
  if (!items.length) return '';
  return items.flatMap((item, i) => [i ? separator : '', <Fragment key={React.isValidElement(item) && item.key != null ? item.key : i}>{item}</Fragment>]);
}
function selectedValue(children) {
  let selected;
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    if (child.props.as === 'option' && child.props.selected) selected = child.props.value ?? child.props.children;
    const nested = selectedValue(child.props.children);
    if (nested !== undefined) selected = nested;
  });
  return selected;
}
export function Ui({ as: Tag, children, ...props }) {
  const ref = useRef(null);
  const [slot, setSlot] = useState(null);
  const original = useRef(children);
  const actualChildren = slot && original.current === children ? slot.node : children;
  useLayoutEffect(() => { original.current = children; });
  useLayoutEffect(() => {
    const node = ref.current;
    slots.set(node, value => { original.current = children; setSlot({ node: value }); });
    return () => slots.delete(node);
  });
  const field = ['input', 'textarea', 'select'].includes(Tag);
  const sourceValue = Tag === 'textarea' ? props.value ?? children : Tag === 'select' ? props.value ?? selectedValue(actualChildren) : props.value;
  const previousValue = useRef(sourceValue);
  useLayoutEffect(() => {
    if (field && sourceValue !== undefined && previousValue.current !== sourceValue) ref.current.value = sourceValue;
    previousValue.current = sourceValue;
  }, [sourceValue]);
  if (field) {
    if ('value' in props) { props.defaultValue = props.value; delete props.value; }
    if ('checked' in props) { props.defaultChecked = props.checked; delete props.checked; }
    if (Tag === 'select' && props.defaultValue === undefined) props.defaultValue = selectedValue(actualChildren);
    if (Tag === 'textarea' && children != null) { props.defaultValue = children; children = undefined; }
  }
  if (Tag === 'option') delete props.selected;
  const initialOpen = useRef(props.open);
  if (Tag === 'details') delete props.open;
  useLayoutEffect(() => { if (Tag === 'details' && initialOpen.current) ref.current.open = true; }, []);
  // data-act 等由各个 React 元素直接处理，不在 document 上委托业务事件。
  for (const [attr, eventName] of [['data-act', 'onClick'], ['data-input', 'onInput'], ['data-change', 'onChange']]) {
    if (props[attr]) props[eventName] = event => {
      if (event.target.closest(`[${attr}]`) !== event.currentTarget || event.currentTarget.disabled) return;
      event.preventDefault();
      if (attr === 'data-act') event.currentTarget.closest('details.menu')?.removeAttribute('open');
      dispatch(props[attr], event.currentTarget, event);
    };
  }
  const at = props['data-flash'];
  useLayoutEffect(() => {
    if (!at || Date.now() - Number(at) > 4000 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    ref.current.animate?.([{ backgroundColor: 'rgba(255,195,77,.28)' }, { backgroundColor: '' }], { duration: 1800 });
  }, [at]);
  return React.createElement(Tag, { ...props, ref }, Tag === 'textarea' ? undefined : actualChildren);
}
export function renderInto(target, node) {
  if (!target) return;
  const update = slots.get(target);
  if (update) return flushSync(() => update(node));
  let root = roots.get(target);
  if (!root) { root = createRoot(target); roots.set(target, root); }
  flushSync(() => root.render(node));
}

// 弹层、提示和喜报通过 portal 保持原来的 DOM 位置。
let overlayId = 0;
const overlays = new Map();
const overlayRoot = createRoot(document.createElement('div'));
function redrawOverlays() { flushSync(() => overlayRoot.render([...overlays.values()])); }
export function mountPortal(container, node) {
  const id = ++overlayId;
  overlays.set(id, createPortal(node, container, String(id)));
  redrawOverlays();
  return () => { overlays.delete(id); redrawOverlays(); };
}
