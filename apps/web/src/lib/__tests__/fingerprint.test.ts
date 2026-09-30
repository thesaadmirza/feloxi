import { describe, it, expect } from "vitest";
import { fingerprint, mergeFailureGroups, splitException } from "../fingerprint";
import type { FailureGroupRow } from "@/types/api";

describe("fingerprint", () => {
  it("parses repr-style exceptions and replaces prefixed ids", () => {
    const fp = fingerprint(
      "ValueError('Payment declined for order order_82bec913: insufficient funds')",
    );
    expect(fp.type).toBe("ValueError");
    expect(fp.template).toBe("Payment declined for order {order_id}: insufficient funds");
    expect(fp.parts).toEqual([
      { text: "Payment declined for order " },
      { param: "order_id" },
      { text: ": insufficient funds" },
    ]);
  });

  it("gives the same key to messages that differ only by an id", () => {
    const a = fingerprint(
      "ValueError('Payment declined for order order_82bec913: insufficient funds')",
    );
    const b = fingerprint(
      "ValueError('Payment declined for order order_048b777d: insufficient funds')",
    );
    expect(a.key).toBe(b.key);
  });

  it("keeps different exception classes apart", () => {
    const a = fingerprint("ValueError('Invalid payment method for user user_3f55431f')");
    const b = fingerprint("TypeError('Invalid payment method for user user_3f55431f')");
    expect(a.key).not.toBe(b.key);
  });

  it("stops urls before sentence punctuation", () => {
    expect(
      fingerprint(
        "RuntimeError('Transcoding failed for https://cdn.example.com/vid_23a85a5c.mp4: codec error')",
      ).template,
    ).toBe("Transcoding failed for {url}: codec error");
    expect(
      fingerprint("OSError('Failed to fetch image: https://cdn.example.com/img_0b67fe23.jpg')")
        .template,
    ).toBe("Failed to fetch image: {url}");
    expect(
      fingerprint(
        `ValueError("Schema mismatch in s3://data/2026/09/inventory.csv: column 'email' missing")`,
      ).template,
    ).toBe("Schema mismatch in {url}: column 'email' missing");
  });

  it("leaves words that merely contain underscores alone", () => {
    const fp = fingerprint(
      `TypeError("setup_billing() missing 1 required positional argument: 'plan'")`,
    );
    expect(fp.type).toBe("TypeError");
    expect(fp.template).toBe("setup_billing() missing 1 required positional argument: 'plan'");
    expect(fp.parts).toEqual([
      { text: "setup_billing() missing 1 required positional argument: 'plan'" },
    ]);
  });

  it("handles the colon form, dotted class paths and empty reprs", () => {
    expect(fingerprint("ValueError: something went wrong")).toMatchObject({
      type: "ValueError",
      template: "something went wrong",
    });
    expect(fingerprint("celery.exceptions.SoftTimeLimitExceeded: took too long").type).toBe(
      "celery.exceptions.SoftTimeLimitExceeded",
    );
    expect(fingerprint("SoftTimeLimitExceeded()")).toMatchObject({
      type: "SoftTimeLimitExceeded",
      template: "",
    });
  });

  it("replaces uuids, emails, long hex and long numbers", () => {
    expect(fingerprint("KeyError('a972760a-a273-4011-a06d-935a7541b74d not found')").template).toBe(
      "{uuid} not found",
    );
    expect(fingerprint("ValueError('bounce from ops@example.com')").template).toBe(
      "bounce from {email}",
    );
    expect(fingerprint("ValueError('digest deadbeef1234 mismatch')").template).toBe(
      "digest {hex} mismatch",
    );
    expect(fingerprint("ValueError('row 123456 rejected, retry 3')").template).toBe(
      "row {n} rejected, retry 3",
    );
  });

  it("uses only the first line of a traceback-like string", () => {
    expect(fingerprint("ValueError: boom\n  File x.py, line 1").template).toBe("boom");
  });
});

describe("mergeFailureGroups", () => {
  const row = (
    exception: string,
    count: number,
    first: number,
    last: number,
    task: string,
    id: string,
  ): FailureGroupRow => ({
    exception,
    count,
    first_seen: first,
    last_seen: last,
    task_names: [task],
    latest_task_id: id,
    latest_traceback: "",
  });

  it("merges variants, sums counts and keeps the newest example", () => {
    const merged = mergeFailureGroups([
      row(
        "ValueError('Payment declined for order order_1111aa: insufficient funds')",
        1,
        100,
        200,
        "tasks.pay",
        "t1",
      ),
      row(
        "ValueError('Payment declined for order order_2222bb: insufficient funds')",
        2,
        50,
        300,
        "tasks.pay",
        "t2",
      ),
      row("OSError('Failed to fetch image: https://x.test/a.jpg')", 5, 10, 20, "tasks.img", "t3"),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].fingerprint.type).toBe("OSError");
    const pay = merged[1];
    expect(pay.count).toBe(3);
    expect(pay.variants).toBe(2);
    expect(pay.first_seen).toBe(50);
    expect(pay.last_seen).toBe(300);
    expect(pay.latest_task_id).toBe("t2");
    expect(pay.task_names).toEqual(["tasks.pay"]);
  });
});

describe("splitException", () => {
  it("reads repr, empty repr and colon forms", () => {
    expect(splitException("ValueError('boom')")).toEqual({ type: "ValueError", message: "boom" });
    expect(splitException("KeyError()")).toEqual({ type: "KeyError", message: "" });
    expect(splitException("requests.exceptions.Timeout: read timed out")).toEqual({
      type: "requests.exceptions.Timeout",
      message: "read timed out",
    });
  });

  it("uses only the first line", () => {
    expect(splitException("TypeError('x')\nTraceback …").type).toBe("TypeError");
  });

  it("falls back to the raw text", () => {
    expect(splitException("worker lost")).toEqual({ type: "", message: "worker lost" });
  });
});
