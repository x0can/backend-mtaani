const express = require("express");
const router = express.Router();

// mount sub-routers
router.use(require("./upload"));
router.use(require("./auth"));
router.use(require("./user"));
router.use(require("./category"));
router.use(require("./product"));
router.use(require("./order"));
router.use(require("./rider"));
router.use(require("./payment"));
router.use(require("./presence"));
router.use(require("./adminStats"));

module.exports = router;
