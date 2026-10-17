const priorities = new Set(['low', 'normal', 'high']);

export function validateTask(body) {
  if (typeof body.title !== 'string' || body.title.trim().length < 3 || body.title.length > 160) {
    throw new Error('Title must contain 3–160 characters.');
  }

  const priority = Object.hasOwn(body, 'priority') ? body.priority : 'normal';
  if (!priorities.has(priority)) {
    throw new Error('Priority must be low, normal, or high.');
  }

  return {title: body.title.trim(), completed: false, priority};
}

export function normalizeStoredTask(task) {
  return Object.hasOwn(task, 'priority') ? task : {...task, priority: 'normal'};
}
