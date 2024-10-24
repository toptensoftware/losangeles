let test = require("node:test");
let assert = require("node:assert");

var la = require('./losangeles');
const LRUCache = require("lru-cache");

var options = {
    contentPath: "./testfiles/",
    $cache: new LRUCache(),
};


test("Parse Page", async () => {

    var page = await la.parsePageFileAsync("./testfiles/basic.page");
    assert.equal(page.prop1, "Hello World");
    assert.equal(page.prop2, 23);
    assert.equal(page.prop3, true);
    assert.equal(page.rawBody, "# Heading 1");
    assert.equal(page.filename, "./testfiles/basic.page");

});

test("Common.page and Single Import", async () => {

    var page = await la.loadPageFileAsync(options, "./testfiles/basic.page");
    assert.equal(page.prop1, "Hello World");
    assert.equal(page.filename, "./testfiles/basic.page");
    assert.equal(page.commonProp1, "common");
    assert.equal(page.importedProp1, "imported");

});

test("Multiple Imports", async () => {

    var page = await la.loadPageFileAsync(options, "./testfiles/multipleImports.page");
    assert.equal(page.importedProp1, "imported");
    assert.equal(page.importedProp2, "imported2");

});

test("Map URL page", async() => {

    var [file, url] = await la.mapUrlToFileAsync(options, "/basic");
    assert.equal(file, "/basic.page");

});

test("Map URL to .md if exists", async() => {

    var [file, url] = await la.mapUrlToFileAsync(options, "/markdown");
    assert.equal(file, "/markdown.md");

});

test("Map root URL to root index page", async() => {

    var [file, url] = await la.mapUrlToFileAsync(options, "/");
    assert.equal(file, "/index.page");

});

test("Map directory URL to directory index page", async() => {

    var [file, url] = await la.mapUrlToFileAsync(options, "/subdir");
    assert.equal(file, "/subdir/index.page");

});


test("Calculates normal image size correctly", () => {

    var imageSize = la.getImageSize("./testfiles/subdir/banner.png");
    assert.deepEqual(imageSize, {width:2040, height:728, type: "png"});

});

test("Caches image sizes correctly", () => {

    var imageSize1 = la.getImageSize("./testfiles/subdir/banner.png");
    var imageSize2 = la.getImageSize("./testfiles/subdir/banner.png");
    assert.deepEqual(imageSize1, imageSize2);

});

test("Calculates retina image size correctly", () => {

    var imageSize = la.getImageSize("./testfiles/subdir/banner@2x.png");
    assert.deepEqual(imageSize, {width:1020, height:364, type: "png"});

});

test("Load page from url", async() => {

    var page = await la.loadPageAsync(options, "/basic");
    assert.equal(page.url, "/basic");
    assert.equal(page.filename, "/basic.page");
    assert.equal(page.rawBody, "# Heading 1")
    assert.equal(page.body, "<h1 id=\"heading-1\">Heading 1</h1>\n")
    assert.equal(page.view, "page");
    assert.equal(page.options, options);

});

test("Loaded page helper functions", async() => {

    var page = await la.loadPageAsync(options, "/subdir/");
    assert.equal(page.url, "/subdir/");
    assert.equal(page.filename, "/subdir/index.page");
    assert.equal(page.options, options);
    assert.equal(page.qualifyUrl("otherpage"), "/subdir/otherpage");
    assert.deepEqual(page.getImageSize("banner@2x.png"), {width: 1020, height:364, type:"png"});
    assert.equal((await page.loadPageAsync("other")).title, "Other");

});

test("Loads external body", async() => {

    var page = await la.loadPageAsync(options, "/externalBody");
    assert(page.body.indexOf("Welcome to Moe-js") >= 0);
    
});

test("Acknowledges noMarkdown option", async() => {

    var page = await la.loadPageAsync(options, "/subdir/noMarkdown");
    assert.equal(page.body, "# Body");

});


test("Formats Markdown code blocks correctly", async() => {

    var page = await la.loadPageAsync(options, "/subdir/markdown");
    assert(page.body.indexOf("language-html") >= 0);
    assert(page.body.indexOf("&lt;p&gt;") >= 0);

});

test("Includes image size in markdown referenced images", async() => {

    var page = await la.loadPageAsync(options, "/subdir/markdown");
    assert(page.body.indexOf("width=\"1020\"") >= 0);
    assert(page.body.indexOf("height=\"364\"") >= 0);

});

test("Caches pages", async() => {

    var page1 = await la.loadPageAsync(options, "/subdir/");
    var page2 = await la.loadPageAsync(options, "/subdir/");
    assert.equal(page1, page2);

});

test("redirects SPA urls", async() => {
    var page = await la.loadPageAsync(options, "/spaApp/folder/folder2/filename");
    assert.equal(page.rewrite, "/spaApp/index.html");
});
