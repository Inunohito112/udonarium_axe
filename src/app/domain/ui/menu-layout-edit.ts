import { isMenuGroup, MenuGroup, MenuItem, MenuLayout, MenuNode } from '@axe/domain/ui/menu-layout';

/** Where an entry sits: on the menu itself, or inside one of its small menus. */
export type MenuParent = string | null;

function everyId(layout: MenuLayout): Set<string> {
  const held = new Set<string>();
  for (const node of layout.nodes) {
    held.add(node.id);
    if (isMenuGroup(node)) for (const item of node.items) held.add(item.id);
  }
  return held;
}

/** A name no entry of this menu goes by yet, counting up from the one asked for. */
function freeId(layout: MenuLayout, wanted: string): string {
  const taken = everyId(layout);
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const tried = `${wanted}-${n}`;
    if (!taken.has(tried)) return tried;
  }
}

function mapNodes(layout: MenuLayout, change: (node: MenuNode) => MenuNode | null): MenuLayout {
  const nodes: MenuNode[] = [];
  for (const node of layout.nodes) {
    const held = change(node);
    if (held) nodes.push(held);
  }
  return { nodes };
}

/** The entry that goes by this name, wherever on the menu it sits. */
export function findMenuNode(layout: MenuLayout, id: string): MenuNode | null {
  for (const node of layout.nodes) {
    if (node.id === id) return node;
    if (isMenuGroup(node)) {
      const item = node.items.find((held) => held.id === id);
      if (item) return item;
    }
  }
  return null;
}

/** Which small menu an entry sits in, or null for one on the menu itself. */
export function parentOfMenuNode(layout: MenuLayout, id: string): MenuParent {
  for (const node of layout.nodes) {
    if (isMenuGroup(node) && node.items.some((held) => held.id === id)) return node.id;
  }
  return null;
}

/** Puts a command on the menu, on the end of the small menu named or of the menu itself. */
export function addMenuItem(layout: MenuLayout, command: string, into: MenuParent = null): MenuLayout {
  const item: MenuItem = { id: freeId(layout, command), command };
  if (into === null) return { nodes: [...layout.nodes, item] };
  return mapNodes(layout, (node) =>
    isMenuGroup(node) && node.id === into ? { ...node, items: [...node.items, item] } : node
  );
}

/** Puts a small menu of somebody's own on the end of the menu. */
export function addMenuGroup(layout: MenuLayout, label: string, icon = 'folder'): MenuLayout {
  const group: MenuGroup = { id: freeId(layout, 'group'), label, icon, items: [] };
  return { nodes: [...layout.nodes, group] };
}

/**
 * Takes an entry off the menu.
 *
 * Taking a small menu off takes what is in it with it, which is what somebody dragging it to the
 * bin means; anything they meant to keep is moved out of it first.
 */
export function removeMenuNode(layout: MenuLayout, id: string): MenuLayout {
  return mapNodes(layout, (node) => {
    if (node.id === id) return null;
    if (!isMenuGroup(node)) return node;
    const items = node.items.filter((item) => item.id !== id);
    return items.length === node.items.length ? node : { ...node, items };
  });
}

function withNode(layout: MenuLayout, id: string, change: (node: MenuNode) => MenuNode): MenuLayout {
  return mapNodes(layout, (node) => {
    if (node.id === id) return change(node);
    if (!isMenuGroup(node)) return node;
    if (!node.items.some((item) => item.id === id)) return node;
    return { ...node, items: node.items.map((item) => (item.id === id ? (change(item) as MenuItem) : item)) };
  });
}

/** Calls an entry something of somebody's own. An empty name leaves it to name itself again. */
export function renameMenuNode(layout: MenuLayout, id: string, label: string): MenuLayout {
  const named = label.trim();
  return withNode(layout, id, (node) => {
    const held = { ...node };
    if (named.length > 0) held.label = named;
    else delete held.label;
    return held;
  });
}

/** Gives an entry a mark of somebody's own. An empty mark leaves it to wear its own again. */
export function setMenuNodeIcon(layout: MenuLayout, id: string, icon: string): MenuLayout {
  const mark = icon.trim();
  return withNode(layout, id, (node) => {
    if (isMenuGroup(node)) return { ...node, icon: mark.length > 0 ? mark : 'folder' };
    const held = { ...node };
    if (mark.length > 0) held.icon = mark;
    else delete held.icon;
    return held;
  });
}

function reorder<T extends { id: string }>(order: readonly T[], id: string, delta: number): T[] | null {
  const from = order.findIndex((held) => held.id === id);
  if (from < 0) return null;
  const to = from + delta;
  if (to < 0 || to >= order.length) return null;
  const moved = [...order];
  const [held] = moved.splice(from, 1);
  moved.splice(to, 0, held);
  return moved;
}

/** Moves an entry a step up or down among the entries it sits with. */
export function moveMenuNode(layout: MenuLayout, id: string, delta: number): MenuLayout {
  const parent = parentOfMenuNode(layout, id);
  if (parent === null) {
    const moved = reorder(layout.nodes, id, delta);
    return moved ? { nodes: moved } : layout;
  }
  return mapNodes(layout, (node) => {
    if (!isMenuGroup(node) || node.id !== parent) return node;
    const moved = reorder(node.items, id, delta);
    return moved ? { ...node, items: moved } : node;
  });
}

/** Puts the entries of a menu, or of one of its small menus, in the order given. */
export function orderMenuNodes(layout: MenuLayout, parent: MenuParent, ids: readonly string[]): MenuLayout {
  if (parent === null) {
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const nodes = ids.map((id) => byId.get(id)).filter((node): node is MenuNode => node !== undefined);
    return nodes.length === layout.nodes.length ? { nodes } : layout;
  }
  return mapNodes(layout, (node) => {
    if (!isMenuGroup(node) || node.id !== parent) return node;
    const byId = new Map(node.items.map((item) => [item.id, item]));
    const items = ids.map((id) => byId.get(id)).filter((item): item is MenuItem => item !== undefined);
    return items.length === node.items.length ? { ...node, items } : node;
  });
}

/**
 * Carries an entry into a small menu, or out onto the menu itself.
 *
 * A small menu cannot be carried into another, since one level is as deep as a menu goes, and
 * nothing is carried into itself.
 */
export function moveMenuNodeInto(layout: MenuLayout, id: string, into: MenuParent): MenuLayout {
  const node = findMenuNode(layout, id);
  if (!node || (isMenuGroup(node) && into !== null) || id === into) return layout;
  if (parentOfMenuNode(layout, id) === into) return layout;

  const without = removeMenuNode(layout, id);
  if (into === null) return { nodes: [...without.nodes, node] };
  return mapNodes(without, (held) =>
    isMenuGroup(held) && held.id === into ? { ...held, items: [...held.items, node as MenuItem] } : held
  );
}
