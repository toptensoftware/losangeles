# Welcome to Los Angeles

Los Angeles is a simple page content server for Node/Express that lets you
author markdown content as .page files with yaml "front matter" that is then
rendered via Express' view engine.

## Features

* Simple but powerful YAML front matter + Markdown page format
* Automatic import of common page settings
* User import of settings from other pages
* Also includes a simple url rewrite/redirect/proxy mapper
* Automatic image size calculation (including retina support)
* Caching of loaded pages

## The Basic Idea

Suppose you had a page "mypage.page" like so:

~~~markdown
---
title: "My Page"
anotherProperty: 23
---
# My Page

Welcome to my page
~~~

Los Angeles loads the above page into a JavaScript object with the following
properties:

~~~json
{
    "title": "My Page",
    "anotherProperty": 23,
    "rawBody": "# My Page\n\nWelcome to my page",
    "body": "<h1>My Page</h1>\n<p>Welcome to my page",
    "filename": "/mypage.page",
    "url": "/mypage",
    "view": "page",
}
~~~

Note: 

* The front-matter is delimited by `---` and can contain any valid YAML.
* The `title` and `anotherProperty` properties come from the page's front matter.
* The `rawBody` is the page content exactly as loaded.
* The `body` property is the page content converted from markdown to html.
* The `filename` and `url` properties are based on where the page was loaded from
* The `view` property defaults to "page" unless explicitly set in the front matter.

Los Angeles provides API to load pages directly, but also includes an Express
middleware that then renders pages via Express view engine framework.


## Documentation

Full documentation for Los Angeles is [available here](https://www.toptensoftware.com/losangeles).