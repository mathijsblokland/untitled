let keuze = 0
function kiesNummer () {
    keuze = randint(1, 3)
}
function wacht () {
    for (let index = 0; index < 2; index++) {
        basic.pause(200)
        // Rock
        basic.showLeds(`
            . . . . .
            . . . . .
            . . # . .
            . . . . .
            . . . . .
            `)
        basic.clearScreen()
    }
}
input.onGesture(Gesture.Shake, function () {
    animatie()
    wacht()
    toonIcoon()
})
function toonIcoon () {
    kiesNummer()
    if (keuze == 1) {
        // Rock
        basic.showLeds(`
            . . # . .
            . # # # .
            # # # # #
            . # # # .
            . . # . .
            `)
    } else if (keuze == 2) {
        // Paper
        basic.showLeds(`
            . # # # .
            . # # # .
            . # # # .
            . # # # .
            . # # # .
            `)
    } else {
        // Scissors
        basic.showLeds(`
            # . . . #
            . # . # .
            . . # . .
            # # . # #
            # # . # #
            `)
    }
}
function animatie () {
    for (let index = 0; index < 2; index++) {
        // Rock
        basic.showLeds(`
            . . # . .
            . # # # .
            # # # # #
            . # # # .
            . . # . .
            `)
        // Paper
        basic.showLeds(`
            . # # # .
            . # # # .
            . # # # .
            . # # # .
            . # # # .
            `)
        // Scissors
        basic.showLeds(`
            # . . . #
            . # . # .
            . . # . .
            # # . # #
            # # . # #
            `)
        basic.clearScreen()
    }
}
