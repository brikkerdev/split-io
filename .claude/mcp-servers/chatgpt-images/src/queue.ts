/**
 * Последовательная очередь: один таск в момент времени.
 * Остальные ждут резолва предыдущего.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    // Хвост не должен «падать» — глотаем ошибку для следующих в очереди.
    this.tail = run.catch(() => undefined);
    return run;
  }
}
