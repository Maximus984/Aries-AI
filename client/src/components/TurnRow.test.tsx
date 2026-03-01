import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TurnRow } from "./TurnRow";

describe("TurnRow", () => {
  it("renders a single Aries response built from both lanes", () => {
    render(
      <TurnRow
        pending={false}
        turn={{
          id: "turn-1",
          userText: "Explain gravity",
          createdAt: "2026-01-01T12:00:00.000Z",
          pro: {
            model: "gemini-pro",
            text: "Detailed answer",
            latencyMs: 450,
            ok: true
          },
          flash: {
            model: "gemini-flash",
            text: "Fast answer",
            latencyMs: 130,
            ok: true
          }
        }}
      />
    );

    expect(screen.getByText("Aries Response")).toBeInTheDocument();
    expect(screen.getAllByText("Detailed answer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fast answer").length).toBeGreaterThan(0);
  });

  it("renders failure for one model while keeping the other result", () => {
    render(
      <TurnRow
        pending={false}
        turn={{
          id: "turn-2",
          userText: "Summarize this",
          createdAt: "2026-01-01T12:01:00.000Z",
          pro: {
            model: "gemini-pro",
            text: "",
            latencyMs: 320,
            ok: false,
            error: "Pro failed"
          },
          flash: {
            model: "gemini-flash",
            text: "Flash still worked",
            latencyMs: 120,
            ok: true
          }
        }}
      />
    );

    expect(screen.getByText("Pro failed")).toBeInTheDocument();
    expect(screen.getAllByText("Flash still worked").length).toBeGreaterThan(0);
  });

  it("calls delete handler when delete is clicked", async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();

    render(
      <TurnRow
        pending={false}
        onDelete={onDelete}
        turn={{
          id: "turn-delete",
          userText: "remove this",
          createdAt: "2026-01-01T12:01:00.000Z",
          pro: {
            model: "gemini-pro",
            text: "ok",
            latencyMs: 150,
            ok: true
          },
          flash: {
            model: "gemini-flash",
            text: "ok",
            latencyMs: 110,
            ok: true
          }
        }}
      />
    );

    const deleteButtons = screen.getAllByRole("button", { name: "Delete message" });
    await user.click(deleteButtons[deleteButtons.length - 1]);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
