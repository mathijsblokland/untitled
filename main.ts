function kiesNummer () {
    keuze = randint(0, 2)
}
input.onButtonPressed(Button.A, function () {
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
    basic.pause(200)
    // Rock
    basic.showLeds(`
        . . . . .
        . . . . .
        . . # . .
        . . . . .
        . . . . .
        `)
    basic.pause(200)
    basic.clearScreen()
    keuze = randint(0, 2)
    if (keuze == 0) {
        // Rock
        basic.showLeds(`
            . . # . .
            . # # # .
            # # # # #
            . # # # .
            . . # . .
            `)
    } else if (keuze == 1) {
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
})
input.onGesture(Gesture.Shake, function () {
    animatie()
    laden()
    kiesNummer()
    if (keuze == 0) {
        // Rock
        basic.showLeds(`
            . . # . .
            . # # # .
            # # # # #
            . # # # .
            . . # . .
            `)
    } else if (keuze == 1) {
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
})
function laden () {
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
    basic.pause(200)
    // Rock
    basic.showLeds(`
        . . . . .
        . . . . .
        . . # . .
        . . . . .
        . . . . .
        `)
    basic.pause(200)
    basic.clearScreen()
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
let keuze = 0
kiesNummer()
