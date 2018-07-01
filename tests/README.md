There are a number of conditions and whatnot that must be tested in more-or-less real-world conditions.

telebit init                    // fresh install
telebit init                    // after install complete

telebit http 3000               // have an app listening on localhost:3000
telebit http 4545               // do not have an app listening

telebit http ./path/to/site
telebit http ./path/to/dir
telebit http ./path/to/file
telebit http ./doesnt/exist

telebit ssh auto                // do have ssh listening on localhost:22
telebit ssh 4545                // do have ssh listenening

telebit tcp 3000                // have an echo server listening on localhost:3000
telebit tcp 4545                // no server listening

telebit tcp ./path/to/file
telebit tcp ./path/to/dir
