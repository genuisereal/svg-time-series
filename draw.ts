﻿declare const require: Function
const d3 = require('d3')
import { line } from 'd3-shape'
import { BaseType, Selection } from 'd3-selection'
import axis = require('./axis')
import { IMinMax, SegmentTree } from './segmentTree'

interface IChartParameters {
	x: Function
	y: Function
	rx: Function
	ry: Function
	xAxis: axis.MyAxis
	yAxis: axis.MyAxis
	gX: any
	gY: any
	view: any
	data: number[][]
	height: number
	line: Function
}

function drawProc(f: any) {
	let requested = false

	return function (...params: any[]) {
		if (!requested) {
			requested = true
			d3.timeout(function (time: any) {
				requested = false
				f(params)
			})
		}
	}
}

export class TimeSeriesChart {
	private chart: IChartParameters
	private minX: Date
	private maxX: Date
	private missedStepsCount: number
	private stepX: number
	private tree: SegmentTree
	private buildSegmentTreeTuple: (index: number, elements: any) => IMinMax
	private zoomHandler: () => void

	constructor(svg: Selection<BaseType, {}, HTMLElement, any>, minX: Date, stepX: number, data: number[][], buildSegmentTreeTuple: (index: number, elements: any) => IMinMax, zoomHandler: () => void) {
		this.stepX = stepX
		this.minX = minX
		this.maxX = this.calcDate(data.length - 1, minX)
		this.buildSegmentTreeTuple = buildSegmentTreeTuple
		this.zoomHandler = zoomHandler

		this.drawChart(svg, data)

		this.missedStepsCount = 0
	}

	public updateChartWithNewData(newData: number[]) {
		this.missedStepsCount++

		this.chart.data.push(newData)

		this.chart.data.shift()

		this.tree = new SegmentTree(this.chart.data, this.chart.data.length, this.buildSegmentTreeTuple)

		this.drawNewData()
	}

	public zoom = drawProc(function(param: any[]) {
		const zoomTransform = param[0]
		d3.zoom().transform(d3.selectAll('.zoom'), zoomTransform)
		const translateX = zoomTransform.x
		const scaleX = zoomTransform.k

		this.chart.rx = zoomTransform.rescaleX(this.chart.x)
		const domainX = this.chart.rx.domain()
		const ySubInterval = this.getZoomIntervalY(domainX, this.chart.data.length)
		const minMax = this.tree.getMinMax(ySubInterval[0], ySubInterval[1])
		const domainY = [minMax.min, minMax.max]
		const newRangeY = [this.chart.y(domainY[0]), this.chart.y(domainY[1])]
		const oldRangeY = this.chart.y.range()
		const scaleY = oldRangeY[0] / (newRangeY[0] - newRangeY[1])
		const translateY = scaleY * (oldRangeY[1] - newRangeY[1])
		const ry = d3.scaleLinear().range([this.chart.height, 0]).domain(domainY)

		this.chart.view.attr('transform', `translate(${translateX},${translateY}) scale(${scaleX},${scaleY})`)
		this.chart.xAxis.setScale(this.chart.rx).axisUp(this.chart.gX)
		this.chart.yAxis.setScale(ry).axisUp(this.chart.gY)
	}.bind(this))

	private drawChart(svg: Selection<BaseType, {}, HTMLElement, any>, data: number[][]) {
		const node: SVGSVGElement = svg.node() as SVGSVGElement
		const div: HTMLElement = node.parentNode as HTMLElement

		const width = div.clientWidth
		const height = div.clientHeight

		svg.attr('width', width)
		svg.attr('height', height)

		const x = d3.scaleTime().range([0, width])
		const y = d3.scaleLinear().range([height, 0])

		const xAxis = new axis.MyAxis(axis.Orientation.Bottom, x)
			.ticks(4)
			.setTickSize(height)
			.setTickPadding(8 - height)

		const yAxis = new axis.MyAxis(axis.Orientation.Right, y)
			.ticks(4)
			.setTickSize(width)
			.setTickPadding(2 - width)

		const drawLine = (cityIdx: number) => d3.line()
			.defined((d: [number, number]) => { 
				return !(isNaN(d[cityIdx]) || d[cityIdx] == null)
			})
			.x((d: number, i: number) => x(this.calcDate(i, this.minX)))
			.y((d: [number, number]) => y(d[cityIdx]))

		this.tree = new SegmentTree(data, data.length, this.buildSegmentTreeTuple)

		x.domain([this.minX, this.maxX])
		const minMax = this.tree.getMinMax(0, this.tree.size - 1)
		y.domain([minMax.min, minMax.max])

		const view = svg.select('g.view')
		const path = view
			.selectAll('path')
			.data([0, 1])
			.enter().append('path')
			.attr('d', (cityIndex: number) => drawLine(cityIndex).call(null, data))

		const gX = svg.append('g')
			.attr('class', 'axis')
			.call(xAxis.axis.bind(xAxis))

		const gY = svg.append('g')
			.attr('class', 'axis')
			.call(yAxis.axis.bind(yAxis))

		svg.append('rect')
			.attr('class', 'zoom')
			.attr('width', width)
			.attr('height', height)
			.call(d3.zoom()
				.scaleExtent([1, 40])
				.translateExtent([[0, 0], [width, height]])
				.on('zoom', this.zoomHandler.bind(this)))

		this.chart = {
			x: x, y: y, rx: x.copy(), ry: y.copy(),
			xAxis: xAxis, yAxis: yAxis, gX: gX, gY: gY,
			view: view, data: data, height: height, line: drawLine
		}
	}

	private getZoomIntervalY(xSubInterval: [Date, Date], intervalSize: number): [number, number] {
		let from = intervalSize
		let to = 0
		for (let i = 0; i < intervalSize; i++) {
			if (this.calcDate(i, this.minX) >= xSubInterval[0] && this.calcDate(i, this.minX) <= xSubInterval[1]) {
				if (i > to) to = i
				if (i < from) from = i
			}
		}
		return [from, to]
	}

	private drawNewData = drawProc(function () {
		const stepsToDraw = this.missedStepsCount
		this.missedStepsCount = 0

		this.minX = this.calcDate(stepsToDraw, this.minX)
		this.maxX = this.calcDate(this.chart.data.length - 1, this.minX)

		const minimumRX = this.calcDate(stepsToDraw, this.chart.rx.domain()[0])
		const maximumRX = this.calcDate(stepsToDraw, this.chart.rx.domain()[1])

		this.chart.x.domain([this.minX, this.maxX])
		this.chart.view.selectAll('path').attr('d', (cityIndex: number) => this.chart.line(cityIndex).call(null, this.chart.data))

		this.chart.rx.domain([minimumRX, maximumRX])
		this.chart.xAxis.setScale(this.chart.rx).axisUp(this.chart.gX)
	}.bind(this))

	private calcDate(index: number, offset: Date) {
		return new Date(index * this.stepX + offset.getTime())
	}
}
