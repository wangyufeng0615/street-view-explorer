import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import useKeyboardNavigation from "./useKeyboardNavigation";

it("does not explore when Space belongs to a button or an open dialog", () => {
  const explore = vi.fn();
  function Example({ modal }) {
    useKeyboardNavigation(explore, false, { current: false });
    return (
      <>
        <button>Action</button>
        {modal && (
          <div role="dialog" aria-modal="true">
            Dialog
          </div>
        )}
      </>
    );
  }
  const { rerender } = render(<Example modal={false} />);
  fireEvent.keyDown(screen.getByRole("button"), { code: "Space" });
  expect(explore).not.toHaveBeenCalled();
  rerender(<Example modal />);
  fireEvent.keyDown(document.body, { code: "Space" });
  expect(explore).not.toHaveBeenCalled();
  rerender(<Example modal={false} />);
  fireEvent.keyDown(document.body, { code: "Space" });
  expect(explore).toHaveBeenCalledTimes(1);
});
