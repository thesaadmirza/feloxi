import { describe, it, expect } from "vitest";
import { shortTaskName, workerLabeler } from "../names";

describe("shortTaskName", () => {
  it("keeps the module and function", () => {
    expect(shortTaskName("tasks.payments.process_payment")).toBe("payments.process_payment");
    expect(shortTaskName("app.tasks.media.resize_image")).toBe("media.resize_image");
  });

  it("leaves short names alone", () => {
    expect(shortTaskName("process_payment")).toBe("process_payment");
    expect(shortTaskName("payments.process")).toBe("payments.process");
  });
});

describe("workerLabeler", () => {
  it("drops a node name every worker shares", () => {
    const label = workerLabeler(["celery@ip-10-0-1-2", "celery@ip-10-0-1-3"]);
    expect(label("celery@ip-10-0-1-2")).toBe("ip-10-0-1-2");
  });

  it("keeps full ids when names differ", () => {
    const label = workerLabeler(["worker-a@host", "celery@host"]);
    expect(label("worker-a@host")).toBe("worker-a@host");
  });

  it("keeps a lone worker's full id", () => {
    expect(workerLabeler(["celery@host"])("celery@host")).toBe("celery@host");
  });
});
