# Transcribee Web Development Setup

Please follow the instructions outlined in [the general development setup document](./development_setup.md)
to get an environment with all the nescessary packages installed.

Then, you can run the dev script (this might take a long time as it downloads / compiles all the dependencies).
Execute `./packaging/dev.sh` in the root folder of the transcribee repo.

Profit! You can now point your browser to [http://localhost:5173/](http://localhost:5173/) and
interact with the running transcribee instance. An admin user with the username "test" and the
password "test" is created for you.

## Add pages

transcribee web contains a minimal page system.
To add pages, add a markdown file to `backend/data/pages`.
If the file contains a frontmatter with the `footer_position` attribute, the page is shown in the footer.
To modify the name shown in the footer, set the `name` attribute in the frontmatter.
Example file named `example.md`:

```md
---
footer_position: 1
name: Example Page
---

# Example Page Showing The Page Feature

Lorem Ipsum Dolor Sit Amet....
```

This page would be available at `/pages/example.md` and shown in the footer with a link labelled `Example Page`.

## More!

There are more specific instructions in the respective readme files of the
[`backend/`](../backend/README.md), [`frontend/`](../frontend/README.md)
and [`worker/`](../worker/README.md) directories.
