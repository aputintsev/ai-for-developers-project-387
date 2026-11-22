# Call Calendar review criteria

## Behavior and scope

- Compare the diff with the source issue, agreed specification, tickets, and human approval linked in the PR. Flag missing evidence and behavior outside the agreed scope.
- Check existing guest and owner flows around the change, including loading, empty, and failure states where relevant.
- For booking changes, verify that a confirmed slot and overlapping intervals are no longer offered. A stale or concurrent booking request must receive a conflict response without creating a second booking.
- For availability changes, check the owner's time zone, the 14-day booking window starting tomorrow, and the meeting type duration. Check date boundaries when time conversion changes.
- For guest booking changes, check that one guest cannot see another guest's bookings and that guest responses exclude names and email addresses.
- For API changes, compare the TypeSpec contract, server behavior, and generated client. Check that validation errors and conflicts reach the UI.

## Evidence and findings

- Check that tests cover the main and negative scenarios and any affected neighboring behavior. Use available CI evidence for the reviewed SHA and identify checks that are pending, skipped, or unavailable.
- Check whether the PR describes who is affected by a regression and how to revert the change and verify recovery. For changes to stored data, check whether code rollback alone restores expected behavior.
- Use the PR discussion to account for decisions about earlier findings. Focus on defects still present in the reviewed revision.
- Give each confirmed finding a severity, file and line, triggering condition, and consequence. If there are no confirmed defects, say so explicitly.
- Leave formatting to the linter. Reserve merge approval for a human reviewer.
