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
router.use(require("./mpesaTest"))
router.use(require("./social"));
router.use(require("./pos"));
router.use(require("./inventory"));
router.use(require("./shifts"));
router.use(require("./suppliers"));
router.use(require("./discounts"));
router.use(require("./reports"));
router.use(require("./customers"));

module.exports = router;
